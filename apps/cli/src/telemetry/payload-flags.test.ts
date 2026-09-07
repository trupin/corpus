import { describe, expect, it } from "vitest";
import { GLOBAL_FLAGS } from "../registry/globals.js";
import { registry } from "../registry/index.js";
import { collectRegistryProblems } from "../registry/validate.js";
import type { CommandSpec, FlagSpec, Registry, TopicSpec } from "../registry/types.js";

/**
 * Which flags carry a caller's bytes (SPEC.md §9.4), pinned exhaustively for the
 * reason every other inventory in this repository is pinned: the failure mode is
 * silent.
 *
 * A file-reading flag added without `payload: true` writes the document
 * correctly, prints nothing unusual and exits 0 — and the document's cost series
 * is short by the whole body. That is what the PHASE-59 evaluation found: the
 * identical 2100-byte reply weighed 182 bytes through `--flag-file` and 2143
 * through a heredoc, so the CLI's own injection-safe transport was the cheapest
 * way to write and the panel could not see the difference.
 */

function payloadPaths(source: Registry): readonly string[] {
  const of = (command: CommandSpec, path: string): readonly string[] =>
    command.flags.filter((flag) => flag.payload === true).map((flag) => `${path} --${flag.name}`);
  const fromTopic = (topic: TopicSpec): readonly string[] =>
    topic.commands.flatMap((command) => of(command, `${topic.name} ${command.name}`));

  return [
    ...source.commands.flatMap((command) => of(command, command.name)),
    ...source.topics.flatMap(fromTopic),
  ].sort();
}

describe("the shipped command surface's payload declarations", () => {
  it("marks exactly the flags whose file becomes what the caller wrote", () => {
    expect(payloadPaths(registry)).toEqual([
      "doc create --file",
      "doc edit --file",
      "doc patch --new-file",
      "doc patch --old-file",
      "skill create --file",
      "thread create --file",
      "thread digest --file",
      "thread reply --file",
    ]);
  });

  it("marks the one global that carries bytes, and only it", () => {
    // `--flag-file` fills any flag on any verb, and the value it builds would be
    // argv in every other spelling — which is counted. So it counts, whatever it
    // fills. `--workspace <path>` names where to act and carries nothing.
    expect(GLOBAL_FLAGS.filter((flag) => flag.payload === true).map((flag) => flag.name)).toEqual([
      "flag-file",
    ]);
    expect(GLOBAL_FLAGS.find((flag) => flag.name === "workspace")?.payload).toBeUndefined();
  });

  it("leaves a path that only names a target unmarked", () => {
    // The scope of the reversal, stated as a test: `--folder` and `--to` say
    // *where* a document goes. Nothing behind them is read, and their argv bytes
    // are their whole cost, exactly as before.
    for (const [path, name] of [
      ["doc create", "folder"],
      ["doc move", "to"],
    ] as const) {
      expect(flagOf(path, name)?.payload).toBeUndefined();
    }
  });
});

/**
 * The rules behind the inventory, so the pin above is a record of the surface
 * rather than the only thing holding the marker on.
 */
describe("the registry refuses an uncounted file flag", () => {
  it("refuses a `--…-file` flag that does not declare its bytes", () => {
    const problems = collectRegistryProblems(
      registryWithFlag({
        name: "notes-file",
        type: "string",
        valueName: "path",
        description: "Read the notes from this file.",
      }),
    );

    expect(problems).toEqual([
      expect.stringContaining(
        'flag "--notes-file" reads a file but does not declare `payload: true`',
      ),
    ]);
  });

  it("accepts the same flag once it declares them", () => {
    expect(
      collectRegistryProblems(
        registryWithFlag({
          name: "notes-file",
          type: "string",
          payload: true,
          valueName: "path",
          description: "Read the notes from this file.",
        }),
      ),
    ).toEqual([]);
  });

  it("refuses the marker on a flag that names no file", () => {
    const problems = collectRegistryProblems(
      registryWithFlag({
        name: "loud",
        type: "boolean",
        payload: true,
        description: "Say more about what happened.",
      }),
    );

    expect(problems).toEqual([
      expect.stringContaining('flag "--loud" is marked as carrying a caller\'s bytes'),
    ]);
  });
});

function flagOf(path: string, name: string): FlagSpec | undefined {
  const [topicName, verb] = path.split(" ");
  const topic = registry.topics.find((candidate) => candidate.name === topicName);
  const command = topic?.commands.find((candidate) => candidate.name === verb);
  return command?.flags.find((flag) => flag.name === name);
}

/**
 * One otherwise-valid command carrying the flag under test, so a failure names
 * the rule being exercised and nothing else.
 */
function registryWithFlag(flag: FlagSpec): Registry {
  return {
    summary: "A fixture surface.",
    commands: [
      {
        name: "act",
        summary: "A fixture verb.",
        args: [],
        flags: [flag],
        examples: [{ command: "corpus act", description: "Fixture." }],
        handler: async () => {
          await Promise.resolve();
        },
      },
    ],
    topics: [],
  };
}
