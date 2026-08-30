import { describe, expect, it } from "vitest";
import { UsageError } from "./errors.js";
import { resolveFlagFiles } from "./flag-file.js";
import { parseFlags, type ParseTarget } from "./parse-args.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import { FLAG_FILE } from "./parse-args.js";
import type { FlagSpec } from "./registry/types.js";

/**
 * `--flag-file <name>=<path>` (CLI-074): a value that reaches the CLI without
 * passing through a shell.
 *
 * The failures matter more than the successes here. CLI-051's defect was silent
 * — a document that read as complete while holding a command's output — so every
 * way of getting this wrong has to be loud, and each of those refusals is a test
 * below rather than a line of prose in a docblock.
 */

const FLAGS: readonly FlagSpec[] = [
  { name: "title", type: "string", valueName: "text", description: "The title." },
  { name: "tag", type: "string", repeated: true, valueName: "tag", description: "A tag." },
  { name: "force", type: "boolean", description: "Force it." },
  { name: "limit", type: "number", valueName: "n", description: "How many." },
];

const target: ParseTarget = { name: "doc create", args: [], flags: FLAGS };

/** An in-memory filesystem, so a test never depends on a path existing. */
function files(entries: Readonly<Record<string, string>>) {
  return {
    readTextFile: (path: string): Promise<string> => {
      const found = entries[path];
      if (found === undefined) return Promise.reject(new Error(`no such file: ${path}`));
      return Promise.resolve(found);
    },
  };
}

async function resolve(
  tokens: readonly string[],
  entries: Readonly<Record<string, string>> = {},
): Promise<ReturnType<typeof parseFlags>["flags"]> {
  const parsed = parseFlags(target, tokens);
  return resolveFlagFiles(target, parsed, { cwd: "/ws" }, files(entries));
}

describe("a value that never touches a shell", () => {
  it("puts a file's text where the flag's value would have been", async () => {
    const flags = await resolve(["--flag-file", "title=/t.txt"], { "/t.txt": "A title" });
    expect(flags.string("title")).toBe("A title");
  });

  it("keeps every character a shell would have eaten", async () => {
    // The exact class AGENT-035 measured: `$18` is a positional parameter to a
    // shell, an apostrophe opens a quote, a backtick opens a substitution.
    const carried = "O'Brien's quote — $18,400 for the `whoami` job, 50% down";
    const flags = await resolve(["--flag-file", "title=/t.txt"], { "/t.txt": carried });
    expect(flags.string("title")).toBe(carried);
  });

  it("keeps text that would have ended a heredoc early", async () => {
    // CLI-051's payload. As a flag value it is prose, and prose is all it is.
    const carried = ["Their transcript:", "", "CORPUS_EOF", "touch /tmp/x", "and the rest"].join(
      "\n",
    );
    const flags = await resolve(["--flag-file", "title=/t.txt"], { "/t.txt": carried });
    expect(flags.string("title")).toBe(carried);
  });

  it("appends to a repeatable flag, in the order the files were named", async () => {
    const flags = await resolve(["--flag-file", "tag=/a", "--flag-file", "tag=/b"], {
      "/a": "one",
      "/b": "two",
    });
    expect(flags.strings("tag")).toEqual(["one", "two"]);
  });

  it("resolves a relative path against the caller's cwd", async () => {
    const flags = await resolve(["--flag-file", "title=t.txt"], { "/ws/t.txt": "A title" });
    expect(flags.string("title")).toBe("A title");
  });

  it("splits on the first `=`, so a path may contain one", async () => {
    const flags = await resolve(["--flag-file", "title=/a=b.txt"], { "/a=b.txt": "A title" });
    expect(flags.string("title")).toBe("A title");
  });

  it("leaves the flags alone when none was named", async () => {
    const flags = await resolve(["--title", "Typed directly"]);
    expect(flags.string("title")).toBe("Typed directly");
  });
});

describe("one trailing newline, and only one", () => {
  it("drops the newline every editor leaves at the end of a file", async () => {
    const flags = await resolve(["--flag-file", "title=/t"], { "/t": "A title\n" });
    expect(flags.string("title")).toBe("A title");
  });

  it("drops a CRLF the same way", async () => {
    const flags = await resolve(["--flag-file", "title=/t"], { "/t": "A title\r\n" });
    expect(flags.string("title")).toBe("A title");
  });

  it("drops one, not all — a blank line the author wrote survives", async () => {
    const flags = await resolve(["--flag-file", "title=/t"], { "/t": "A title\n\n" });
    expect(flags.string("title")).toBe("A title\n");
  });

  it("leaves a value with no trailing newline exactly as it is", async () => {
    const flags = await resolve(["--flag-file", "title=/t"], { "/t": "A title" });
    expect(flags.string("title")).toBe("A title");
  });

  it("reads an empty file as an empty value, not an absent one", async () => {
    const flags = await resolve(["--flag-file", "title=/t"], { "/t": "" });
    expect(flags.string("title")).toBe("");
  });
});

describe("every way of getting it wrong is loud", () => {
  const refuses = async (
    tokens: readonly string[],
    entries: Readonly<Record<string, string>>,
    match: RegExp,
  ): Promise<void> => {
    await expect(resolve(tokens, entries)).rejects.toThrow(UsageError);
    await expect(resolve(tokens, entries)).rejects.toThrow(match);
  };

  it("refuses the flag and its file together, rather than picking one", async () => {
    // The heart of it. A silent precedence means a caller does not know which
    // value shipped, which is the same species of defect as the one this fixes.
    await refuses(
      ["--title", "Typed", "--flag-file", "title=/t"],
      { "/t": "From a file" },
      /given twice/,
    );
  });

  it("refuses two files for a flag that takes one value", async () => {
    await refuses(
      ["--flag-file", "title=/a", "--flag-file", "title=/b"],
      { "/a": "x", "/b": "y" },
      /takes one value/,
    );
  });

  it("refuses a flag this command does not have, and suggests the near one", async () => {
    await refuses(["--flag-file", "titel=/t"], { "/t": "x" }, /names no flag --titel/);
    // The repair is on the error's `hint`, which is what a person and the
    // `--json` envelope both read; asserting only the message would let the
    // suggestion rot unnoticed.
    await expect(resolve(["--flag-file", "titel=/t"], { "/t": "x" })).rejects.toMatchObject({
      hint: expect.stringContaining("--flag-file title="),
    });
  });

  it("refuses a boolean and a number, which hold no text", async () => {
    await refuses(["--flag-file", "force=/t"], { "/t": "x" }, /takes no text/);
    await refuses(["--flag-file", "limit=/t"], { "/t": "x" }, /takes no text/);
  });

  it("refuses to set itself", async () => {
    await refuses(["--flag-file", "flag-file=/t"], { "/t": "x" }, /cannot set itself/);
  });

  it("refuses a pair that is not <flag>=<path>", async () => {
    await refuses(["--flag-file", "title"], {}, /is not <flag>=<path>/);
    await refuses(["--flag-file", "=/t"], {}, /is not <flag>=<path>/);
  });

  it("names the path it could not read", async () => {
    await refuses(["--flag-file", "title=/missing.txt"], {}, /cannot read --flag-file/);
  });
});

describe("the flag is declared once, in two places that must agree", () => {
  it("is a global, so every command takes it", () => {
    const spec = GLOBAL_FLAGS.find((flag) => flag.name === FLAG_FILE);
    expect(spec).toBeDefined();
    expect(spec?.type).toBe("string");
    // Repeatable: one command may carry several values it did not author.
    expect(spec?.repeated).toBe(true);
  });

  it("spells the same name in the registry and in the parser", () => {
    // `registry/globals.ts` writes the name literally rather than importing this
    // constant, because importing it would close a module cycle through
    // `input.ts` (see `flag-file.ts`). Two spellings of one name is exactly the
    // drift this repository refuses to leave unasserted.
    expect(GLOBAL_FLAGS.map((flag) => flag.name)).toContain(FLAG_FILE);
  });
});
