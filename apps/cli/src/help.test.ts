import { describe, expect, it } from "vitest";
import { UsageError } from "./errors.js";
import { gloss } from "./gloss.js";
import {
  argDescription,
  commandSynopsis,
  flagDescription,
  flagUsage,
  parseHelpMode,
  renderCommandHelp,
  renderRootHelp,
  renderTopicHelp,
} from "./help.js";
import {
  fixtureEverythingCommand,
  fixtureProseCommand,
  fixtureRegistry,
  fixtureTopic,
} from "./registry/fixtures.js";
import { GLOBAL_FLAGS } from "./registry/globals.js";
import type { FlagSpec } from "./registry/types.js";

const plain = { color: false };
const brief = { color: false, mode: "brief" } as const;
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

describe("parseHelpMode", () => {
  it("reads the two modes and defaults to full", () => {
    expect(parseHelpMode(undefined)).toBe("full");
    expect(parseHelpMode("full")).toBe("full");
    expect(parseHelpMode("brief")).toBe("brief");
  });

  it.each(["short", "", "BRIEF", "true"])("refuses %j as a usage error", (raw) => {
    expect(() => parseHelpMode(raw)).toThrow(UsageError);
    expect(() => parseHelpMode(raw)).toThrow(/unknown help mode/);
  });
});

describe("--help=brief", () => {
  const command = renderCommandHelp(fixtureProseCommand, brief);
  const full = renderCommandHelp(fixtureProseCommand, plain);

  it("matches its snapshot", () => {
    expect(command).toMatchSnapshot();
  });

  it("matches its snapshot for a topic verb too", () => {
    expect(renderCommandHelp(fixtureEverythingCommand, brief)).toMatchSnapshot();
  });

  it("leaves the full text untouched, and full is what an unset mode renders", () => {
    expect(renderCommandHelp(fixtureProseCommand, { color: false, mode: "full" })).toBe(full);
    expect(full).toContain("A paragraph that `--help=brief` drops entirely");
    expect(full).toContain("Deeper runs cost more");
    expect(full).toContain("Examples:");
  });

  it("drops the description paragraph and the examples", () => {
    expect(command).not.toContain("A paragraph that `--help=brief` drops entirely");
    expect(command).not.toContain("Examples:");
    expect(command).not.toContain("Expound upon doc-1.");
  });

  it("keeps the summary, the synopsis and every name", () => {
    expect(command).toContain("corpus expound — Say a great deal about very little.");
    expect(command).toContain("corpus expound <target> [flags]");
    expect(command).toContain("<target>");
    expect(command).toContain("--depth <number>");
    expect(command).toContain("--aside <string>");
  });

  it("renders each description's first sentence and drops the rest", () => {
    for (const flag of fixtureProseCommand.flags) {
      expect(command).toContain(gloss(flag.description));
    }
    expect(command).toContain("The thing to expound upon.");
    expect(command).not.toContain("Deeper runs cost more");
    expect(command).not.toContain("rendered after the main text");
    expect(command).not.toContain("read from the workspace");
  });

  it("keeps the default and the repeatability, which are not prose", () => {
    expect(command).toContain("(default: 2)");
    expect(command).toContain("(repeatable)");
  });

  it("keeps the global flags, glossed", () => {
    for (const flag of GLOBAL_FLAGS) {
      expect(command).toContain(`--${flag.name}`);
      expect(command).toContain(gloss(flag.description));
    }
    // The `--json` paragraph is four sentences; only the first survives.
    expect(command).not.toContain("so absence never has to be guessed at");
  });

  it("points at the full text", () => {
    expect(command).toContain("Run `corpus expound --help` for the full text and examples.");
  });

  it("costs a fraction of the full text", () => {
    const words = (text: string): number => text.trim().split(/\s+/).length;
    expect(words(command)).toBeLessThan(words(full) / 2);
  });

  it("strips a topic help down to its verbs", () => {
    const help = renderTopicHelp(fixtureTopic, brief);
    expect(help).toContain("corpus widget — Manage widgets.");
    expect(help).toContain("Show one widget.");
    expect(help).not.toContain("A fixture topic standing in");
    expect(help).not.toContain("Global flags:");
    expect(help).toContain("Run `corpus widget --help` for the full text.");
  });

  it("strips the root help down to its commands and topics", () => {
    const help = renderRootHelp(fixtureRegistry, brief);
    expect(help).toContain("everything");
    expect(help).toContain("widget");
    expect(help).not.toContain("Global flags:");
    expect(help).not.toContain("docs/cli.md");
    expect(help).toContain("Run `corpus --help` for the full text.");
  });

  it("still emits no ANSI escapes when colour is off, and bolds when it is on", () => {
    expect(ANSI.test(renderCommandHelp(fixtureProseCommand, brief))).toBe(false);
    expect(ANSI.test(renderTopicHelp(fixtureTopic, { color: true, mode: "brief" }))).toBe(true);
    expect(ANSI.test(renderRootHelp(fixtureRegistry, { color: true, mode: "brief" }))).toBe(true);
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
    // A flag with a `bareValue` reads its value from `--flag=value` alone, and
    // the bracketed placeholder is what says so.
    expect(
      flagUsage({
        name: "help",
        alias: "h",
        type: "string",
        valueName: "mode",
        bareValue: "full",
        description: "",
      }),
    ).toBe("-h, --help[=<mode>]");
    expect(
      flagDescription({ name: "count", type: "number", default: 3, description: "Count." }),
    ).toBe("Count. (default: 3)");
    expect(
      flagDescription({ name: "tag", type: "string", repeated: true, description: "Tag." }),
    ).toBe("Tag. (repeatable)");
  });

  it("glosses a description in brief and leaves it whole in full", () => {
    const flag: FlagSpec = {
      name: "depth",
      type: "number",
      default: 2,
      description: "How far. Or not.",
    };
    expect(flagDescription(flag, "full")).toBe("How far. Or not. (default: 2)");
    expect(flagDescription(flag)).toBe("How far. Or not. (default: 2)");
    expect(flagDescription(flag, "brief")).toBe("How far. (default: 2)");

    const arg = { name: "id", required: true, description: "The id. Read from the workspace." };
    expect(argDescription(arg)).toBe("The id. Read from the workspace.");
    expect(argDescription(arg, "brief")).toBe("The id.");
  });

  it("marks required arguments with angle brackets and optional ones with square brackets", () => {
    expect(commandSynopsis(fixtureEverythingCommand)).toBe(
      "corpus everything <target> [note] [flags]",
    );
  });
});
