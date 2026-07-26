import { describe, expect, it } from "vitest";
import {
  commandSynopsis,
  flagDescription,
  flagUsage,
  renderCommandHelp,
  renderRootHelp,
  renderTopicHelp,
} from "./help.js";
import { fixtureEverythingCommand, fixtureRegistry, fixtureTopic } from "./registry/fixtures.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";

const plain = { color: false };
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[`);

describe("renderRootHelp", () => {
  const help = renderRootHelp(fixtureRegistry, plain);

  it("matches its snapshot", () => {
    expect(help).toMatchSnapshot();
  });

  it("lists every top-level command and topic with its summary", () => {
    for (const command of fixtureRegistry.commands) {
      expect(help).toContain(command.name);
      expect(help).toContain(command.summary);
    }
    expect(help).toContain(fixtureTopic.name);
    expect(help).toContain(fixtureTopic.summary);
  });

  it("lists the global flags", () => {
    for (const flag of GLOBAL_FLAGS) expect(help).toContain(`--${flag.name}`);
  });

  it("omits sections the registry does not declare", () => {
    const topicsOnly = renderRootHelp(
      { summary: "topics only.", commands: [], topics: [fixtureTopic] },
      plain,
    );
    expect(topicsOnly).not.toContain("Commands:");
    expect(topicsOnly).toContain("Topics:");

    const commandsOnly = renderRootHelp(
      { summary: "commands only.", commands: fixtureRegistry.commands, topics: [] },
      plain,
    );
    expect(commandsOnly).not.toContain("Topics:");
  });
});

describe("renderTopicHelp", () => {
  const help = renderTopicHelp(fixtureTopic, plain);

  it("matches its snapshot", () => {
    expect(help).toMatchSnapshot();
  });

  it("lists the topic's verbs and its description", () => {
    expect(help).toContain("list");
    expect(help).toContain("Show one widget.");
    expect(help).toContain("A fixture topic standing in for `server`, `doc` and friends.");
  });

  it("omits the description paragraph when the topic has none", () => {
    const bare = {
      name: fixtureTopic.name,
      summary: fixtureTopic.summary,
      commands: fixtureTopic.commands,
    };
    expect(renderTopicHelp(bare, plain)).not.toContain("A fixture topic standing in");
  });
});

describe("renderCommandHelp", () => {
  const help = renderCommandHelp(fixtureEverythingCommand, plain);

  it("matches its snapshot", () => {
    expect(help).toMatchSnapshot();
  });

  it("shows arguments, the command's own flags, the merged globals and the examples", () => {
    expect(help).toContain("<target>");
    expect(help).toContain("[note]");
    expect(help).toContain("-l, --loud");
    expect(help).toContain("--count <number>");
    expect(help).toContain("--json");
    expect(help).toContain("corpus everything doc-1 --loud");
    expect(help).toContain("Act loudly on doc-1.");
  });

  it("prefixes a topic verb's synopsis with its topic", () => {
    const verb = fixtureTopic.commands[1];
    expect(verb).toBeDefined();
    if (verb === undefined) return;
    const rendered = renderCommandHelp(verb, { ...plain, topic: fixtureTopic.name });
    expect(rendered).toContain("corpus widget show <id> [flags]");
  });

  it("omits the arguments and flags sections when the command declares none", () => {
    const [list] = fixtureTopic.commands;
    expect(list).toBeDefined();
    if (list === undefined) return;
    const rendered = renderCommandHelp({ ...list, flags: [] }, plain);
    expect(rendered).not.toContain("Arguments:");
    expect(rendered).not.toContain("\nFlags:");
  });
});

describe("colour", () => {
  it("emits no ANSI escapes when colour is off", () => {
    expect(ANSI.test(renderRootHelp(fixtureRegistry, plain))).toBe(false);
    expect(ANSI.test(renderTopicHelp(fixtureTopic, plain))).toBe(false);
    expect(ANSI.test(renderCommandHelp(fixtureEverythingCommand, plain))).toBe(false);
  });

  it("bolds headings when colour is on", () => {
    expect(ANSI.test(renderRootHelp(fixtureRegistry, { color: true }))).toBe(true);
    expect(ANSI.test(renderTopicHelp(fixtureTopic, { color: true }))).toBe(true);
    expect(ANSI.test(renderCommandHelp(fixtureEverythingCommand, { color: true }))).toBe(true);
  });
});

describe("flag and synopsis rendering", () => {
  it("renders the alias, the value placeholder and the annotations", () => {
    expect(flagUsage({ name: "loud", alias: "l", type: "boolean", description: "" })).toBe(
      "-l, --loud",
    );
    expect(flagUsage({ name: "title", type: "string", valueName: "text", description: "" })).toBe(
      "--title <text>",
    );
    expect(flagUsage({ name: "count", type: "number", description: "" })).toBe("--count <number>");
    expect(
      flagDescription({ name: "count", type: "number", default: 3, description: "Count." }),
    ).toBe("Count. (default: 3)");
    expect(
      flagDescription({ name: "tag", type: "string", repeated: true, description: "Tag." }),
    ).toBe("Tag. (repeatable)");
  });

  it("marks required arguments with angle brackets and optional ones with square brackets", () => {
    expect(commandSynopsis(fixtureEverythingCommand)).toBe(
      "corpus everything <target> [note] [flags]",
    );
  });
});
