import { describe, expect, it } from "vitest";
import { ExitCode, UsageError } from "./errors.js";
import {
  argUsage,
  mergedFlags,
  ParsedArgs,
  ParsedFlags,
  parseCommandInput,
  type ParseTarget,
} from "./parse-args.js";
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

describe("a flag declaring a bareValue", () => {
  const optional: ParseTarget = {
    name: "optional",
    args: [{ name: "target", required: false, description: "A positional." }],
    flags: [
      {
        name: "mode",
        type: "string",
        valueName: "mode",
        bareValue: "full",
        description: "A flag whose value may be left off.",
      },
    ],
  };

  it("is absent when it is not typed", () => {
    expect(parseCommandInput(optional, []).flags.string("mode")).toBeUndefined();
  });

  it("means its bare value when typed with none", () => {
    expect(parseCommandInput(optional, ["--mode"]).flags.string("mode")).toBe("full");
  });

  it("takes an inline value", () => {
    expect(parseCommandInput(optional, ["--mode=brief"]).flags.string("mode")).toBe("brief");
    // An empty inline value is passed through rather than silently becoming the
    // bare one: whoever consumes it decides, and `--mode=` is not `--mode`.
    expect(parseCommandInput(optional, ["--mode="]).flags.string("mode")).toBe("");
  });

  it("never reads the following token", () => {
    // The whole reason the field exists: `corpus doc list --help` must print
    // help, not consume a positional and then complain about a missing one.
    const parsed = parseCommandInput(optional, ["--mode", "doc-1"]);
    expect(parsed.flags.string("mode")).toBe("full");
    expect(parsed.args.optional("target")).toBe("doc-1");
  });

  it("does not error at the end of argv the way a value-taking flag does", () => {
    const required: ParseTarget = {
      name: "required",
      args: [],
      flags: [{ name: "mode", type: "string", description: "An ordinary string flag." }],
    };
    expect(() => parseCommandInput(required, ["--mode"])).toThrow(/requires a value/);
    expect(() => parseCommandInput(optional, ["--mode"])).not.toThrow();
  });

  it("is how the real --help flag is declared", () => {
    const help = GLOBAL_FLAGS.find((flag) => flag.name === "help");
    expect(help?.type).toBe("string");
    expect(help?.bareValue).toBe("full");
    expect(parse(["doc-1", "--help"]).flags.string("help")).toBe("full");
    expect(parse(["doc-1", "--help=brief"]).flags.string("help")).toBe("brief");
    expect(parse(["doc-1"]).flags.string("help")).toBeUndefined();
    expect(parse(["-h", "doc-1"]).flags.string("help")).toBe("full");
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

  it("reads a scalar, a list and an absent argument through one accessor", () => {
    const args = new ParsedArgs(
      new Map<string, string | readonly string[]>([
        ["one", "a"],
        ["many", ["a", "b"]],
      ]),
    );
    expect(args.list("one")).toEqual(["a"]);
    expect(args.list("many")).toEqual(["a", "b"]);
    expect(args.list("missing")).toEqual([]);
  });

  it("does not hand a list back through the scalar accessors", () => {
    const args = new ParsedArgs(new Map<string, string | readonly string[]>([["many", ["a"]]]));
    expect(() => args.get("many")).toThrow(/No positional argument named "many"/);
    expect(args.optional("many")).toBeUndefined();
  });
});

describe("a variadic positional", () => {
  /** `corpus doc check [id…]`'s shape: optional, last, absorbing. */
  const variadic: ParseTarget = {
    name: "check",
    args: [{ name: "id", required: false, variadic: true, description: "Documents to check." }],
    flags: [{ name: "staged", type: "boolean", description: "Check the index." }],
  };

  it("absorbs every remaining positional, in order", () => {
    const { args } = parseCommandInput(variadic, ["doc_a", "doc_b", "--staged", "doc_c"]);
    expect(args.list("id")).toEqual(["doc_a", "doc_b", "doc_c"]);
  });

  it("binds an empty list when nothing is given, rather than failing", () => {
    expect(parseCommandInput(variadic, []).args.list("id")).toEqual([]);
    expect(parseCommandInput(variadic, ["--staged"]).flags.boolean("staged")).toBe(true);
  });

  it("never reports an unexpected argument, however many are given", () => {
    expect(parseCommandInput(variadic, ["a", "b", "c", "d"]).args.list("id")).toHaveLength(4);
  });

  it("still requires at least one value when it is declared required", () => {
    const required: ParseTarget = {
      name: "check",
      args: [{ name: "id", required: true, variadic: true, description: "Documents to check." }],
      flags: [],
    };
    expect(() => parseCommandInput(required, [])).toThrow(/missing required argument <id…>/);
    expect(parseCommandInput(required, ["doc_a"]).args.list("id")).toEqual(["doc_a"]);
  });

  it("follows a fixed argument, absorbing only what is left", () => {
    const mixed: ParseTarget = {
      name: "mixed",
      args: [
        { name: "head", required: true, description: "First." },
        { name: "rest", required: false, variadic: true, description: "The remainder." },
      ],
      flags: [],
    };
    const { args } = parseCommandInput(mixed, ["one", "two", "three"]);
    expect(args.get("head")).toBe("one");
    expect(args.list("rest")).toEqual(["two", "three"]);
  });
});

describe("argUsage", () => {
  it("writes each shape the way help, the synopsis and docs/cli.md all show it", () => {
    expect(argUsage({ name: "id", required: true, description: "d" })).toBe("<id>");
    expect(argUsage({ name: "id", required: false, description: "d" })).toBe("[id]");
    expect(argUsage({ name: "id", required: true, variadic: true, description: "d" })).toBe(
      "<id…>",
    );
    expect(argUsage({ name: "id", required: false, variadic: true, description: "d" })).toBe(
      "[id…]",
    );
  });
});
