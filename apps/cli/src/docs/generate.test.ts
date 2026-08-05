import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../errors.js";
import { fixtureRegistry } from "../registry/fixtures.js";
import { registry } from "../registry/index.js";
import { GLOBAL_FLAGS } from "../registry/globals.js";
import { cliPackageRoot } from "../version.js";
import { anchor, CLI_DOCS_RELATIVE_PATH, DOCS_HEADER, generateCliDocs } from "./generate.js";

const committed = readFileSync(
  resolve(cliPackageRoot(), "..", "..", CLI_DOCS_RELATIVE_PATH),
  "utf8",
);

describe("generateCliDocs", () => {
  it("is idempotent: two runs are byte-identical", () => {
    expect(generateCliDocs(registry)).toBe(generateCliDocs(registry));
  });

  it("carries the do-not-edit header", () => {
    expect(generateCliDocs(registry).startsWith(DOCS_HEADER)).toBe(true);
    expect(DOCS_HEADER).toContain("do not edit by hand");
  });

  it("matches the committed docs/cli.md, which is how drift is caught", () => {
    expect(committed).toBe(generateCliDocs(registry));
  });

  it("documents every command in the shipped registry with its examples", () => {
    const docs = generateCliDocs(registry);
    for (const command of registry.commands) {
      expect(docs).toContain(`## \`corpus ${command.name}\``);
      expect(docs).toContain(command.summary);
      for (const example of command.examples) expect(docs).toContain(example.command);
    }
  });

  it("documents topics, verbs, arguments and flags", () => {
    const docs = generateCliDocs(fixtureRegistry);
    expect(docs).toContain("## `corpus widget`");
    expect(docs).toContain("### `corpus widget show`");
    expect(docs).toContain("**Arguments**");
    expect(docs).toContain("| `target` | yes      | The thing to act on. |");
    expect(docs).toContain("**Flags**");
    expect(docs).toContain("`--tag <string>`");
    expect(docs).toContain("string (repeatable)");
    expect(docs).toContain("Runs outside a workspace: this command does not require one.");
  });

  it("lists every global flag", () => {
    const docs = generateCliDocs(registry);
    for (const flag of GLOBAL_FLAGS) expect(docs).toContain(`\`--${flag.name}`);
  });

  it("documents that --help beats --json", () => {
    expect(generateCliDocs(registry)).toContain("`--help` is a deliberate exception to `--json`");
  });

  it("appends the exit-code table", () => {
    const docs = generateCliDocs(registry);
    expect(docs).toContain("## Exit codes");
    for (const entry of EXIT_CODES) {
      expect(docs).toContain(`| \`${String(entry.code)}\``);
      expect(docs).toContain(entry.meaning);
    }
  });

  it("sorts topics and commands by name, so the output cannot depend on declaration order", () => {
    const reversed = {
      summary: fixtureRegistry.summary,
      commands: [...fixtureRegistry.commands].reverse(),
      topics: [
        {
          ...fixtureRegistry.topics[0],
          name: "widget",
          summary: "Manage widgets.",
          commands: [...(fixtureRegistry.topics[0]?.commands ?? [])].reverse(),
        },
      ],
    };
    expect(generateCliDocs(reversed)).toBe(generateCliDocs(fixtureRegistry));
  });

  it("refuses to generate from an invalid registry", () => {
    expect(() =>
      generateCliDocs({
        summary: "broken.",
        commands: [
          {
            name: "broken",
            summary: "No examples.",
            args: [],
            flags: [],
            examples: [],
            handler: async () => {
              await Promise.resolve();
            },
          },
        ],
        topics: [],
      }),
    ).toThrow(/has no examples/);
  });

  it("ends with exactly one trailing newline and no blank-line runs", () => {
    const docs = generateCliDocs(registry);
    expect(docs.endsWith("\n")).toBe(true);
    expect(docs.endsWith("\n\n")).toBe(false);
    expect(docs).not.toContain("\n\n\n");
  });
});

describe("anchor", () => {
  it.each([
    ["corpus health", "corpus-health"],
    ["corpus widget show", "corpus-widget-show"],
    ["Exit codes", "exit-codes"],
    ["Global flags", "global-flags"],
  ])("turns %j into %j", (heading, expected) => {
    expect(anchor(heading)).toBe(expected);
  });

  it("links every contents entry to a heading that exists", () => {
    const docs = generateCliDocs(fixtureRegistry);
    const links = [...docs.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((match) => match[1]);
    const headings = [...docs.matchAll(/^#{1,3} (.+)$/gm)].map((match) => anchor(match[1] ?? ""));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(headings).toContain(link);
  });
});
