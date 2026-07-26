import { describe, expect, it } from "vitest";
import { ExitCode, UsageError } from "./errors.js";
import { mergedFlags, ParsedArgs, ParsedFlags, parseCommandInput } from "./parse-args.js";
import { fixtureEverythingCommand } from "./registry/fixtures.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";

const target = fixtureEverythingCommand;

function parse(tokens: readonly string[]) {
  return parseCommandInput(target, tokens);
}

describe("parseCommandInput", () => {
  it("parses each declared flag type into its declared type", () => {
    const { flags } = parse([
      "doc-1",
      "--loud",
      "--title",
      "Release notes",
      "--count",
      "7",
      "--tag",
      "a",
      "--tag",
      "b",
    ]);
    expect(flags.boolean("loud")).toBe(true);
    expect(flags.string("title")).toBe("Release notes");
    expect(flags.number("count")).toBe(7);
    expect(flags.strings("tag")).toEqual(["a", "b"]);
  });

  it("accepts the --flag=value form and the short alias", () => {
    const { flags } = parse(["doc-1", "-l", "--title=Hello", "--count=2"]);
    expect(flags.boolean("loud")).toBe(true);
    expect(flags.string("title")).toBe("Hello");
    expect(flags.number("count")).toBe(2);
  });

  it("applies declared defaults and the implicit boolean default", () => {
    const { flags } = parse(["doc-1"]);
    expect(flags.number("count")).toBe(3);
    expect(flags.boolean("loud")).toBe(false);
    expect(flags.strings("tag")).toEqual([]);
    expect(flags.string("title")).toBeUndefined();
  });

  it("merges the global flags into every command", () => {
    const { flags } = parse(["doc-1", "--json", "--workspace", "/tmp/ws", "--timeout", "250"]);
    expect(flags.boolean("json")).toBe(true);
    expect(flags.string("workspace")).toBe("/tmp/ws");
    expect(flags.number("timeout")).toBe(250);
  });

  it("lets --flag=false turn a boolean off", () => {
    const { flags } = parse(["doc-1", "--loud=false"]);
    expect(flags.boolean("loud")).toBe(false);
  });

  it("takes the last value for a non-repeated flag", () => {
    const { flags } = parse(["doc-1", "--title", "first", "--title", "second"]);
    expect(flags.string("title")).toBe("second");
  });

  it("binds positionals in declaration order, leaving optional ones undefined", () => {
    expect(parse(["doc-1"]).args.optional("note")).toBeUndefined();
    const { args } = parse(["doc-1", "a note"]);
    expect(args.get("target")).toBe("doc-1");
    expect(args.get("note")).toBe("a note");
  });

  it("treats everything after `--` as a positional", () => {
    const { args } = parse(["doc-1", "--", "--not-a-flag"]);
    expect(args.get("note")).toBe("--not-a-flag");
  });

  it("treats a bare `-` as a positional", () => {
    expect(parse(["-"]).args.get("target")).toBe("-");
  });

  it.each([
    [["doc-1", "--nope"], 'unknown flag "--nope"'],
    [["doc-1", "--title"], "flag --title requires a value"],
    [["doc-1", "--count", "abc"], 'flag --count expects a number, got "abc"'],
    [["doc-1", "--loud=maybe"], "flag --loud is a boolean"],
    [[], "missing required argument <target>"],
    [["doc-1", "note", "extra"], 'unexpected argument "extra"'],
  ])("rejects %j as a usage error with exit code 2", (tokens, expected) => {
    let thrown: unknown;
    try {
      parse(tokens);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UsageError);
    expect(thrown).toHaveProperty("exitCode", ExitCode.usageError);
    expect((thrown as Error).message).toContain(expected);
  });

  it("suggests a near-miss flag name", () => {
    try {
      parse(["doc-1", "--tite", "x"]);
      expect.unreachable("expected a usage error");
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect(error instanceof UsageError ? error.hint : "").toContain("Did you mean --title?");
    }
  });

  it("lists the known flags when nothing is close enough to suggest", () => {
    try {
      parse(["doc-1", "--zzzzzzzz"]);
      expect.unreachable("expected a usage error");
    } catch (error) {
      const hint = error instanceof UsageError ? (error.hint ?? "") : "";
      expect(hint).toContain("Known flags:");
      expect(hint).not.toContain("Did you mean");
    }
  });

  it("rejects an unknown short alias", () => {
    expect(() => parse(["doc-1", "-z"])).toThrow(UsageError);
  });
});

describe("mergedFlags", () => {
  it("puts the globals in front of the command's own flags", () => {
    const names = mergedFlags(target.flags).map((flag) => flag.name);
    expect(names.slice(0, GLOBAL_FLAGS.length)).toEqual(GLOBAL_FLAGS.map((flag) => flag.name));
    expect(names).toContain("title");
  });
});

describe("ParsedFlags", () => {
  it("returns type-appropriate empties for absent or mistyped values", () => {
    const flags = new ParsedFlags(new Map([["title", "text"]]));
    expect(flags.boolean("title")).toBe(false);
    expect(flags.number("title")).toBeUndefined();
    expect(flags.strings("title")).toEqual([]);
    expect(flags.string("missing")).toBeUndefined();
  });

  it("keeps only string entries out of a repeated flag", () => {
    const flags = new ParsedFlags(new Map([["tag", ["a", 2]]]));
    expect(flags.strings("tag")).toEqual(["a"]);
  });
});

describe("ParsedArgs", () => {
  it("throws for an argument the command never declared", () => {
    const args = new ParsedArgs(new Map());
    expect(() => args.get("nope")).toThrow(/No positional argument named "nope"/);
  });
});
