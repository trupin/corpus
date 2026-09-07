import { MAX_REPORT_SUBJECTS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { bindPositionals, parseFlags } from "../parse-args.js";
import { registry } from "../registry/index.js";
import type { CommandSpec, Registry, TopicSpec } from "../registry/types.js";
import { collectSubjects } from "./subjects.js";

/**
 * Which documents an invocation names (SPEC.md §9.4), and — the point of the
 * whole design — that the answer comes out of the **registry's declarations**
 * rather than out of a scan of the command line.
 */

const noop = async (): Promise<void> => {
  await Promise.resolve();
};

/**
 * One fixture verb naming ids in every shape the registry can express, plus the
 * id-shaped values that are *not* documents. Built here rather than reused from
 * `registry/fixtures.ts` so that changing a docs snapshot never changes what
 * this rule is tested against.
 */
const fixture: CommandSpec = {
  name: "act",
  summary: "A fixture verb naming documents in every declarable shape.",
  args: [
    { name: "target", required: true, subject: true, description: "A document id." },
    { name: "note", required: false, description: "Not an id at all." },
    { name: "extra", required: false, variadic: true, subject: true, description: "More ids." },
  ],
  flags: [
    { name: "parent", type: "string", subject: true, description: "A document id in a flag." },
    { name: "columns", type: "string", subject: true, description: "A comma-separated list." },
    { name: "also", type: "string", repeated: true, subject: true, description: "Repeatable." },
    { name: "job", type: "string", description: "A queue event id, which is not a document." },
    { name: "loud", type: "boolean", description: "Carries no value." },
  ],
  examples: [{ command: "corpus act doc_a1", description: "Fixture." }],
  handler: noop,
};

function subjectsOf(tokens: readonly string[]): readonly string[] {
  const parsed = parseFlags(fixture, tokens);
  return collectSubjects(fixture, bindPositionals(fixture, parsed.positionals), parsed.flags);
}

describe("the subjects an invocation names", () => {
  it("takes a marked positional, and leaves an unmarked one alone", () => {
    expect(subjectsOf(["doc_a1", "doc_b2"])).toEqual(["doc_a1"]);
  });

  it("takes every token of a marked variadic argument", () => {
    expect(subjectsOf(["doc_a1", "a note", "doc_b2", "th_c3"])).toEqual([
      "doc_a1",
      "doc_b2",
      "th_c3",
    ]);
  });

  it("takes a marked flag's value, positional or not", () => {
    expect(subjectsOf(["doc_a1", "--parent", "th_p9"])).toEqual(["doc_a1", "th_p9"]);
  });

  it("takes every occurrence of a marked repeatable flag", () => {
    expect(subjectsOf(["doc_a1", "--also", "doc_b2", "--also", "doc_c3"])).toEqual([
      "doc_a1",
      "doc_b2",
      "doc_c3",
    ]);
  });

  it("splits a marked comma-separated value, since no id contains a comma", () => {
    expect(subjectsOf(["doc_a1", "--columns", "doc_b2,doc_c3"])).toEqual([
      "doc_a1",
      "doc_b2",
      "doc_c3",
    ]);
  });

  it("ignores an id-shaped value on an unmarked flag", () => {
    // `--job` carries an `evt_*` in the real surface; even handed a document id
    // it names no document, because the declaration says it does not.
    expect(subjectsOf(["doc_a1", "--job", "doc_b2"])).toEqual(["doc_a1"]);
  });

  it("drops a value that is not a document id, rather than losing the whole report", () => {
    // The wire refuses a malformed subject with a 400, and a refused report is
    // lost whole — so one mistyped id would cost the invocation its measurement.
    expect(subjectsOf(["not-an-id"])).toEqual([]);
    expect(subjectsOf(["evt_7c1d"])).toEqual([]);
    expect(subjectsOf(["doc_a1", "--columns", ""])).toEqual(["doc_a1"]);
  });

  it("counts a document named twice once, because it was paid for once", () => {
    expect(subjectsOf(["doc_a1", "doc_a1", "--parent", "doc_a1"])).toEqual(["doc_a1"]);
  });

  it("caps the list at what the wire admits", () => {
    const many = Array.from({ length: MAX_REPORT_SUBJECTS + 10 }, (_v, i) => `doc_x${String(i)}`);
    expect(subjectsOf(many)).toHaveLength(MAX_REPORT_SUBJECTS);
  });

  it("is driven by the declaration: the same argv names nothing without the marker", () => {
    // The proof that no scan is happening. Identical tokens, identical parse,
    // and the only difference is one word in the registry.
    const unmarked: CommandSpec = {
      ...fixture,
      args: fixture.args.map(({ subject: _subject, ...rest }) => rest),
      flags: fixture.flags.map(({ subject: _subject, ...rest }) => rest),
    };
    const parsed = parseFlags(unmarked, ["doc_a1", "--parent", "doc_b2"]);
    expect(
      collectSubjects(unmarked, bindPositionals(unmarked, parsed.positionals), parsed.flags),
    ).toEqual([]);
  });
});

/**
 * The shipped surface's own inventory (CLI-085).
 *
 * Pinned exhaustively, in both directions, for the reason the repository pins
 * every other inventory: a new id-taking argument added without the marker is
 * silently unattributed — nothing fails, no warning prints, and a document's
 * series is quietly short. Here it is a failing diff whose fix is one word.
 */
function markedPaths(source: Registry): readonly string[] {
  const of = (command: CommandSpec, path: string): readonly string[] => [
    ...command.args.filter((arg) => arg.subject === true).map((arg) => `${path} <${arg.name}>`),
    ...command.flags
      .filter((flag) => flag.subject === true)
      .map((flag) => `${path} --${flag.name}`),
  ];
  const fromTopic = (topic: TopicSpec): readonly string[] =>
    topic.commands.flatMap((command) => of(command, `${topic.name} ${command.name}`));

  return [
    ...source.commands.flatMap((command) => of(command, command.name)),
    ...source.topics.flatMap(fromTopic),
  ].sort();
}

describe("the shipped command surface's subject declarations", () => {
  it("marks exactly the arguments and flags that name a document or a thread", () => {
    expect(markedPaths(registry)).toEqual([
      "board order <id>",
      "doc archive <id>",
      "doc check <id>",
      "doc create --columns",
      "doc delete <id>",
      "doc detach <id>",
      "doc diff <id>",
      "doc edit --columns",
      "doc edit <id>",
      "doc list --parent",
      "doc list --references",
      "doc move <id>",
      "doc patch <id>",
      "doc related <id>",
      "doc show <id>",
      "doc unarchive <id>",
      "job list --origin",
      "queue claim-all --thread",
      "queue defer --blocked-on",
      "queue idle --thread",
      "search --parent",
      "search --references",
      "thread context <id>",
      "thread create --parent",
      "thread designate <id>",
      "thread digest <id>",
      "thread release <id>",
      "thread reopen <id>",
      "thread reply <id>",
      "thread resolve <id>",
      "thread scope <id>",
      "thread show <id>",
    ]);
  });

  it("marks nothing on the verbs that name no document", () => {
    // `search` and `doc list` take a query or filters and return ids in their
    // output; attributing a listing's cost to what it returned would be a
    // different metric from §9.4's. Both appear above only for the two *filter*
    // flags a caller may type, and neither is present in the bare invocation.
    const bare = ["agents", "batch", "health", "reflect", "tree", "init", "upgrade"];
    for (const name of bare) {
      const command = registry.commands.find((candidate) => candidate.name === name);
      expect(command === undefined ? [] : markedPathsOf(command)).toEqual([]);
    }
  });
});

function markedPathsOf(command: CommandSpec): readonly string[] {
  return [
    ...command.args.filter((arg) => arg.subject === true),
    ...command.flags.filter((flag) => flag.subject === true),
  ].map((declaration) => declaration.name);
}
