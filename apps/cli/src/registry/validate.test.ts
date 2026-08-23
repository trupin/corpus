import { describe, expect, it } from "vitest";
import { countWords, gloss, MAX_GLOSS_WORDS } from "../gloss.js";
import { fixtureRegistry, noopHandler } from "./fixtures.js";
import { GLOBAL_FLAGS } from "./globals.js";
import { registry } from "./index.js";
import type { CommandSpec, Registry } from "./types.js";
import { collectRegistryProblems, RegistryValidationError, validateRegistry } from "./validate.js";

function command(overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    name: "probe",
    summary: "A probe.",
    args: [],
    flags: [],
    examples: [{ command: "corpus probe", description: "Probe." }],
    handler: noopHandler,
    ...overrides,
  };
}

function registryOf(commands: readonly CommandSpec[]): Registry {
  return { summary: "fixture.", commands, topics: [] };
}

describe("the shipped registry", () => {
  it("passes validation", () => {
    expect(collectRegistryProblems(registry)).toEqual([]);
  });

  it("exposes `corpus health` as a top-level command", () => {
    expect(registry.commands.map((entry) => entry.name)).toContain("health");
  });

  it("gives every command at least one example, which is what keeps docs/cli.md useful", () => {
    for (const entry of [...registry.commands, ...registry.topics.flatMap((t) => t.commands)]) {
      expect(entry.examples.length).toBeGreaterThan(0);
    }
  });
});

describe("the fixture registry", () => {
  it("passes validation, so tests built on it are testing real shapes", () => {
    expect(collectRegistryProblems(fixtureRegistry)).toEqual([]);
  });
});

describe("collectRegistryProblems", () => {
  it("rejects duplicate top-level names", () => {
    const problems = collectRegistryProblems(registryOf([command(), command()]));
    expect(problems).toContain('duplicate top-level name "probe"');
  });

  it("rejects a name that collides between a command and a topic", () => {
    const problems = collectRegistryProblems({
      summary: "fixture.",
      commands: [command({ name: "widget" })],
      topics: [{ name: "widget", summary: "Topic.", commands: [command()] }],
    });
    expect(problems).toContain('duplicate top-level name "widget"');
  });

  it("rejects a command with no summary, naming the command", () => {
    const problems = collectRegistryProblems(registryOf([command({ summary: "  " })]));
    expect(problems).toContain("corpus probe has no summary");
  });

  it("rejects a command with no examples, naming the command", () => {
    const problems = collectRegistryProblems(registryOf([command({ examples: [] })]));
    expect(problems).toContain("corpus probe has no examples");
  });

  it("rejects an example that is not a corpus command line", () => {
    const problems = collectRegistryProblems(
      registryOf([command({ examples: [{ command: "health", description: "Probe." }] })]),
    );
    expect(problems).toContain("corpus probe example 1 is not a `corpus …` command line");
  });

  it("rejects an example with no description", () => {
    const problems = collectRegistryProblems(
      registryOf([command({ examples: [{ command: "corpus probe", description: "" }] })]),
    );
    expect(problems).toContain("corpus probe example 1 has no description");
  });

  it.each([
    ["json", 'corpus probe flag "--json" shadows a global flag'],
    ["workspace", 'corpus probe flag "--workspace" shadows a global flag'],
  ])("rejects a topic flag shadowing --%s", (name, expected) => {
    const problems = collectRegistryProblems(
      registryOf([command({ flags: [{ name, type: "boolean", description: "Shadow." }] })]),
    );
    expect(problems).toContain(expected);
  });

  it("rejects a flag alias shadowing the global -h", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({ flags: [{ name: "hold", alias: "h", type: "boolean", description: "Hold." }] }),
      ]),
    );
    expect(problems).toContain('corpus probe flag "--hold" shadows the global alias "-h"');
  });

  it("rejects duplicate flags and reused aliases within one command", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          flags: [
            { name: "one", alias: "o", type: "boolean", description: "One." },
            { name: "one", type: "boolean", description: "One again." },
            { name: "other", alias: "o", type: "boolean", description: "Other." },
          ],
        }),
      ]),
    );
    expect(problems).toContain('corpus probe declares flag "--one" twice');
    expect(problems).toContain('corpus probe reuses the alias "-o"');
  });

  it("rejects a multi-character alias", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({ flags: [{ name: "one", alias: "on", type: "boolean", description: "One." }] }),
      ]),
    );
    expect(problems).toContain('corpus probe flag "--one" has a multi-character alias "-on"');
  });

  it("rejects a flag with no description or a non-kebab-case name", () => {
    const problems = collectRegistryProblems(
      registryOf([command({ flags: [{ name: "Loud", type: "boolean", description: " " }] })]),
    );
    expect(problems).toContain('corpus probe flag "--Loud" is not kebab-case');
    expect(problems).toContain('corpus probe flag "--Loud" has no description');
  });

  it("rejects a repeated boolean flag and mistyped defaults", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          flags: [
            { name: "loud", type: "boolean", repeated: true, description: "Loud." },
            { name: "quiet", type: "boolean", default: "no", description: "Quiet." },
            { name: "count", type: "number", default: "many", description: "Count." },
          ],
        }),
      ]),
    );
    expect(problems).toContain(
      'corpus probe flag "--loud" is a repeated boolean, which has no meaning',
    );
    expect(problems).toContain('corpus probe flag "--quiet" has a non-boolean default');
    expect(problems).toContain('corpus probe flag "--count" has a non-numeric default');
  });

  it("rejects a required argument declared after an optional one", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          args: [
            { name: "first", required: false, description: "First." },
            { name: "second", required: true, description: "Second." },
          ],
        }),
      ]),
    );
    expect(problems).toContain(
      'corpus probe declares required argument "second" after an optional one',
    );
  });

  it("rejects an argument declared after a variadic one", () => {
    // A variadic absorbs every remaining token, so anything behind it could
    // never be bound — a spec the parser cannot honour.
    const problems = collectRegistryProblems(
      registryOf([
        command({
          args: [
            { name: "first", required: false, variadic: true, description: "First." },
            { name: "second", required: false, description: "Second." },
          ],
        }),
      ]),
    );
    expect(problems).toContain(
      'corpus probe declares variadic argument "first" before another argument',
    );
  });

  it("accepts a variadic argument in last position", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          args: [
            { name: "first", required: true, description: "First." },
            { name: "rest", required: false, variadic: true, description: "The remainder." },
          ],
        }),
      ]),
    );
    expect(problems).toEqual([]);
  });

  it("rejects duplicate, undocumented and non-kebab-case arguments", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          args: [
            { name: "Id", required: true, description: "" },
            { name: "Id", required: true, description: "Again." },
          ],
        }),
      ]),
    );
    expect(problems).toContain('corpus probe declares argument "Id" twice');
    expect(problems).toContain('corpus probe argument "Id" is not kebab-case');
    expect(problems).toContain('corpus probe argument "Id" has no description');
  });

  it("rejects a non-kebab-case command name and a registry with no summary", () => {
    const problems = collectRegistryProblems({
      summary: "",
      commands: [command({ name: "Probe" })],
      topics: [],
    });
    expect(problems).toContain("the registry has no summary");
    expect(problems).toContain('command name "Probe" is not kebab-case');
  });

  it("rejects an empty topic, a duplicate verb and a bad topic name", () => {
    const problems = collectRegistryProblems({
      summary: "fixture.",
      commands: [],
      topics: [
        { name: "Empty", summary: " ", commands: [] },
        { name: "dup", summary: "Dup.", commands: [command(), command()] },
      ],
    });
    expect(problems).toContain('topic name "Empty" is not kebab-case');
    expect(problems).toContain("corpus Empty has no summary");
    expect(problems).toContain("corpus Empty declares no verbs");
    expect(problems).toContain('corpus dup declares "probe" twice');
  });
});

describe("the gloss rule", () => {
  const words = (count: number): string =>
    `${Array.from({ length: count }, () => "word").join(" ")}.`;

  it("accepts an opening sentence at the cap and refuses the one past it", () => {
    const atCap = registryOf([
      command({
        flags: [
          {
            name: "long",
            type: "boolean",
            description: `${words(MAX_GLOSS_WORDS)} And a second sentence nobody measures.`,
          },
        ],
      }),
    ]);
    expect(collectRegistryProblems(atCap)).toEqual([]);

    const overCap = registryOf([
      command({
        flags: [
          {
            name: "long",
            type: "boolean",
            description: `${words(MAX_GLOSS_WORDS + 1)} And a second sentence.`,
          },
        ],
      }),
    ]);
    const problems = collectRegistryProblems(overCap);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`corpus probe flag "--long" opens with a 31-word sentence`);
    expect(problems[0]).toContain("--help=brief");
  });

  it("measures a positional argument by the same rule", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          args: [
            { name: "id", required: true, description: `${words(MAX_GLOSS_WORDS + 5)} More.` },
          ],
        }),
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('corpus probe argument "id" opens with a 35-word sentence');
  });

  it("holds the global flags to it too, since brief help prints them", () => {
    // They are not declared by any command, so nothing else in this file would
    // ever reach them.
    for (const flag of GLOBAL_FLAGS) {
      expect(countWords(gloss(flag.description))).toBeLessThanOrEqual(MAX_GLOSS_WORDS);
    }
  });

  it("refuses a bareValue on a flag that takes no string value", () => {
    const problems = collectRegistryProblems(
      registryOf([
        command({
          flags: [{ name: "loud", type: "boolean", bareValue: "full", description: "A boolean." }],
        }),
      ]),
    );
    expect(problems).toEqual([
      'corpus probe flag "--loud" declares a bareValue but is not a string flag',
    ]);
  });
});

describe("validateRegistry", () => {
  it("returns the registry unchanged when it is valid", () => {
    expect(validateRegistry(fixtureRegistry)).toBe(fixtureRegistry);
  });

  it("throws a RegistryValidationError listing every problem", () => {
    const broken = registryOf([command({ summary: "", examples: [] })]);
    expect(() => validateRegistry(broken)).toThrow(RegistryValidationError);
    try {
      validateRegistry(broken);
      expect.unreachable("validateRegistry should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistryValidationError);
      const problems = error instanceof RegistryValidationError ? error.problems : [];
      expect(problems).toHaveLength(2);
      expect((error as Error).message).toContain("corpus probe has no summary");
    }
  });
});
