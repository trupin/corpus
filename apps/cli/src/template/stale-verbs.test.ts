import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registry } from "../registry/index.js";
import type { Registry } from "../registry/types.js";
import { collectIncoming } from "./incoming.js";
import {
  citationsIn,
  commandSurface,
  instructionFiles,
  staleVerbCitations,
} from "./stale-verbs.js";

const surface = commandSurface(registry);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-stale-verbs-"));
  roots.push(root);
  return root;
}

function write(root: string, relative: string, content: string): void {
  const absolute = join(root, ...relative.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const fence = (...lines: readonly string[]): string => ["```bash", ...lines, "```", ""].join("\n");

describe("citationsIn", () => {
  it("reports a removed verb taught inside a fenced block", () => {
    const found = citationsIn(
      ".claude/skills/orchestrate/SKILL.md",
      ["Recover the loop:", "", fence("corpus skill rollback orchestrate")].join("\n"),
      surface,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.command).toBe("skill rollback");
    expect(found[0]?.path).toBe(".claude/skills/orchestrate/SKILL.md");
    expect(found[0]?.line).toBe(4);
    expect(found[0]?.text).toBe("corpus skill rollback orchestrate");
    expect(found[0]?.hint).toBe("`corpus skill --help=brief` lists the verbs `corpus skill` has.");
  });

  it("reports an inline citation, and names the whole line so it can be found", () => {
    const found = citationsIn(
      "CLAUDE.md",
      "Undo it with `corpus skill rollback orchestrate` before you continue.\n",
      surface,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.text).toBe(
      "Undo it with `corpus skill rollback orchestrate` before you continue.",
    );
  });

  it("sends an unknown top-level name to the root help instead", () => {
    const found = citationsIn("CLAUDE.md", fence("corpus frobnicate"), surface);
    expect(found).toHaveLength(1);
    expect(found[0]?.command).toBe("frobnicate");
    expect(found[0]?.hint).toBe("`corpus --help=brief` lists every command this tool has.");
  });

  it("reports nothing for commands the installed registry has", () => {
    const source = [
      fence(
        "corpus queue idle",
        "corpus doc list --type note --json",
        "corpus workspace upgrade",
        "corpus health",
      ),
      "Park with `corpus queue idle`, then `corpus queue claim-all`.\n",
      "A bare topic prints its help: `corpus doc`.\n",
      "Global flags only: `corpus --help=brief`.\n",
    ].join("\n");
    expect(citationsIn("CLAUDE.md", source, surface)).toEqual([]);
  });

  /**
   * The false positive that matters (CLI-059 decision 3): a sentence whose whole
   * job is to say the verb is gone must not be reported as teaching it.
   */
  it("does not flag prose explaining that a verb was removed", () => {
    const sentences = [
      "There is no `corpus skill rollback`, and here that is the point.",
      "`corpus skill rollback` was removed in v0.11; use git instead.",
      "`corpus skill rollback` no longer exists.",
      "`corpus skill rollback` does not exist — read the history and write the content back.",
      "`corpus skill rollback` used to be the answer; it is not one now.",
      "There is no such command as `corpus skill rollback`.",
    ];
    for (const sentence of sentences) {
      expect(citationsIn("README.md", `${sentence}\n`, surface), sentence).toEqual([]);
    }
  });

  it("still flags the same verb inside a fenced block on a page that explains the removal", () => {
    // The prose guard is scoped to the sentence, never to the file: a page may
    // explain a removal in one paragraph and still teach the dead verb in a
    // worked block further down, and that block is what an agent copies.
    const found = citationsIn(
      "README.md",
      ["`corpus skill rollback` was removed.", "", fence("corpus skill rollback orchestrate")].join(
        "\n",
      ),
      surface,
    );
    expect(found.map((citation) => citation.command)).toEqual(["skill rollback"]);
  });

  it("never reads prose outside a code span", () => {
    const source = [
      "The corpus CLI is the only interface the agent has.\n",
      "corpus skill rollback is described elsewhere in this paragraph.\n",
    ].join("");
    expect(citationsIn("README.md", source, surface)).toEqual([]);
  });

  it("skips a heredoc body up to its terminator", () => {
    const found = citationsIn(
      "SKILL.md",
      fence(
        "corpus thread reply th_1 --from agent <<'CORPUS_EOF'",
        "corpus skill rollback is a command this reply merely mentions.",
        "CORPUS_EOF",
        "corpus queue idle",
      ),
      surface,
    );
    expect(found).toEqual([]);
  });

  it("splits a compound line and judges each command on its own", () => {
    const found = citationsIn(
      "SKILL.md",
      fence("corpus queue idle && corpus skill rollback orchestrate | jq -r .id"),
      surface,
    );
    expect(found.map((citation) => citation.command)).toEqual(["skill rollback"]);
  });

  it("never mistakes a global flag's value for a command name", () => {
    const found = citationsIn(
      "SKILL.md",
      fence("corpus --workspace /srv/notes doc list", "corpus --from agent doc create --title x"),
      surface,
    );
    expect(found).toEqual([]);
  });

  it("makes no claim about a placeholder", () => {
    const found = citationsIn(
      "SKILL.md",
      [fence("corpus <topic> <verb>", "corpus doc <verb>", "corpus $LANE idle"), ""].join("\n"),
      surface,
    );
    expect(found).toEqual([]);
  });

  it("does not read a commented-out line as a command", () => {
    expect(citationsIn("SKILL.md", fence("# corpus skill rollback orchestrate"), surface)).toEqual(
      [],
    );
  });

  /**
   * CLI-084, TEST-1119. The report that opened that issue blamed the two-token
   * cap in `corpusInvocations`: `corpus thread digest set <id>` has three words,
   * so the parser was said to mis-read it. It does not. `set` is a positional
   * argument of `thread digest`, the cap stops before it on purpose, and this
   * pins that the real registry resolves the line the report quoted.
   */
  it("resolves a verb whose own grammar takes a positional action word", () => {
    const found = citationsIn(
      ".claude/skills/converse/SKILL.md",
      fence(
        "corpus thread digest set th_4b8e2c --from agent <<'CORPUS_EOF'",
        "a rolling account of the conversation",
        "CORPUS_EOF",
      ),
      surface,
    );
    expect(found).toEqual([]);
  });

  it("reports every citation in a file, in line order", () => {
    const found = citationsIn(
      "SKILL.md",
      [fence("corpus skill rollback a"), fence("corpus frobnicate"), ""].join("\n"),
      surface,
    );
    expect(found.map((citation) => [citation.line, citation.command])).toEqual([
      [2, "skill rollback"],
      [6, "frobnicate"],
    ]);
  });
});

describe("staleVerbCitations", () => {
  it("scans a workspace's skills, agents and root instructions", () => {
    const root = scratch();
    write(root, "CLAUDE.md", fence("corpus skill rollback orchestrate"));
    write(root, "README.md", fence("corpus frobnicate"));
    write(root, ".claude/skills/orchestrate/SKILL.md", fence("corpus doc frobnicate"));
    write(root, ".claude/agents/reviewer.md", fence("corpus thread frobnicate"));

    const found = staleVerbCitations({ root, registry });
    expect(found.map((citation) => `${citation.path}: ${citation.command}`)).toEqual([
      "CLAUDE.md: skill rollback",
      "README.md: frobnicate",
      ".claude/skills/orchestrate/SKILL.md: doc frobnicate",
      ".claude/agents/reviewer.md: thread frobnicate",
    ]);
  });

  it("leaves an archived skill alone, because nothing discovers it", () => {
    const root = scratch();
    write(root, ".claude/skills-archived/old/SKILL.md", fence("corpus skill rollback old"));
    expect(staleVerbCitations({ root, registry })).toEqual([]);
    expect(instructionFiles(root)).toEqual([]);
  });

  it("reports nothing for a workspace that has none of those files", () => {
    expect(staleVerbCitations({ root: scratch(), registry })).toEqual([]);
  });

  /**
   * CLI-059's "a current workspace produces no findings", against the real
   * template rather than a fixture: every file `corpus init` installs today,
   * placed where it installs it.
   */
  it("finds nothing in a workspace built from the shipped template", () => {
    const root = scratch();
    for (const file of collectIncoming()) {
      const to = join(root, ...file.path.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(file.from, to);
    }
    expect(instructionFiles(root).length).toBeGreaterThan(3);
    expect(staleVerbCitations({ root, registry })).toEqual([]);
  });

  /**
   * CLI-084. `corpus upgrade` installs the new package and then syncs from the
   * process it started in, so the template on disk is the incoming tool's while
   * the registry in memory is the outgoing tool's. These model that pair
   * directly: `withoutThreadDigest` is the outgoing build, and the template root
   * is the incoming one's own skills.
   */
  describe("against an incoming tool the running build predates", () => {
    const withoutThreadDigest: Registry = {
      ...registry,
      topics: registry.topics.map((topic) =>
        topic.name === "thread"
          ? { ...topic, commands: topic.commands.filter((command) => command.name !== "digest") }
          : topic,
      ),
    };

    /** A template tree, in the layout `planTemplateInstall` walks. */
    function templateOf(files: Readonly<Record<string, string>>): string {
      const root = scratch();
      for (const [relative, content] of Object.entries(files)) write(root, relative, content);
      return root;
    }

    it("does not flag a verb the incoming tool's own skills teach", () => {
      const root = scratch();
      write(
        root,
        ".claude/skills/converse/SKILL.md",
        fence("corpus thread digest set th_4b8e2c --from agent"),
      );
      const templateRoot = templateOf({
        "claude/skills/converse/SKILL.md": fence("corpus thread digest set th_4b8e2c --from agent"),
      });

      // The outgoing build alone: the false positive CLI-084 reports.
      expect(
        staleVerbCitations({ root, registry: withoutThreadDigest }).map((c) => c.command),
      ).toEqual(["thread digest"]);

      // Told which tool the template came from, it says nothing.
      expect(
        staleVerbCitations({ root, registry: withoutThreadDigest, tool: { templateRoot } }),
      ).toEqual([]);
    });

    it("still flags a verb the incoming tool dropped", () => {
      // CLI-059's purpose, and the half that must survive the fix: the incoming
      // skills do not teach `skill rollback`, so nothing vouches for it.
      const root = scratch();
      write(root, "CLAUDE.md", fence("corpus skill rollback orchestrate"));
      const templateRoot = templateOf({
        "claude/skills/converse/SKILL.md": fence("corpus thread digest set th_4b8e2c"),
        "CLAUDE.md": fence("corpus queue idle"),
      });

      expect(
        staleVerbCitations({ root, registry, tool: { templateRoot } }).map((c) => c.command),
      ).toEqual(["skill rollback"]);
    });

    it("vouches for the verb the incoming skills name and for no other", () => {
      const root = scratch();
      write(root, "CLAUDE.md", fence("corpus thread frobnicate th_1"));
      const templateRoot = templateOf({
        "claude/skills/converse/SKILL.md": fence("corpus thread digest set th_4b8e2c"),
      });

      expect(
        staleVerbCitations({ root, registry: withoutThreadDigest, tool: { templateRoot } }).map(
          (c) => c.command,
        ),
      ).toEqual(["thread frobnicate"]);
    });

    it("vouches for a whole name this build knows as neither command nor topic", () => {
      // A release that adds a topic outright: this build would report every
      // `corpus plan …` line under the one name, so vouching for the name is
      // exactly as fine-grained as the finding it replaces.
      const root = scratch();
      write(root, "CLAUDE.md", fence("corpus plan review pl_1", "corpus plan draft"));
      const templateRoot = templateOf({
        "claude/skills/orchestrate/SKILL.md": fence("corpus plan draft --from agent"),
      });

      expect(staleVerbCitations({ root, registry, tool: { templateRoot } })).toEqual([]);
    });

    it("does not vouch from a sentence explaining that the verb is gone", () => {
      const root = scratch();
      write(root, "CLAUDE.md", fence("corpus thread digest set th_1"));
      const templateRoot = templateOf({
        "claude/skills/converse/SKILL.md": "`corpus thread digest` no longer exists.\n",
      });

      expect(
        staleVerbCitations({ root, registry: withoutThreadDigest, tool: { templateRoot } }).map(
          (c) => c.command,
        ),
      ).toEqual(["thread digest"]);
    });

    it("keeps the registry's own surface when the incoming template cannot be read", () => {
      const root = scratch();
      write(root, "CLAUDE.md", fence("corpus thread digest set th_1"));

      expect(
        staleVerbCitations({
          root,
          registry: withoutThreadDigest,
          tool: { templateRoot: join(scratch(), "gone") },
        }).map((c) => c.command),
      ).toEqual(["thread digest"]);
    });

    it("reads the shipped template as its own vouching, and finds nothing", () => {
      // The real template against the real registry, through the vouching path:
      // widening the surface may never turn a clean workspace into a dirty one.
      const root = scratch();
      for (const file of collectIncoming()) {
        const to = join(root, ...file.path.split("/"));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(file.from, to);
      }
      expect(staleVerbCitations({ root, registry, tool: {} })).toEqual([]);
    });
  });

  it("judges against the registry it is handed, not a list of removed verbs", () => {
    const root = scratch();
    write(root, "CLAUDE.md", fence("corpus health"));
    expect(staleVerbCitations({ root, registry })).toEqual([]);

    // A build without `corpus health` reports the same file, with no change
    // here and no allowlist anywhere: the surface is the only input.
    const smaller: Registry = {
      ...registry,
      commands: registry.commands.filter((command) => command.name !== "health"),
    };
    expect(staleVerbCitations({ root, registry: smaller }).map((c) => c.command)).toEqual([
      "health",
    ]);
  });
});
