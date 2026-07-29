import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CORE_DOC_TYPES, DocumentIdSchema, IsoDateTimeSchema } from "@corpus/contract";
import { describe, expect, it } from "vitest";
// Read-only, and deliberately the real thing: `corpus init` creates exactly these
// directories, so importing them is what stops the install contract from drifting
// away from the implementation it documents.
import { WORKSPACE_DIRECTORIES } from "../apps/cli/src/commands/init/scaffold.js";
import {
  CLI_COMMANDS_PENDING_CLI_006,
  CONTRACT_DOC_PATH,
  INIT_GENERATED,
  INSTALL_FILTERS,
  INSTALL_RENAMES,
  TEMPLATE_ROOT,
  TemplateError,
  extractCorpusInvocations,
  installedPath,
  listTemplateFiles,
  loadTemplateDocuments,
  normalizeInvocation,
  parseCliDoc,
  parseContractDoc,
  parseFrontmatter,
  readCliDoc,
  readContractDoc,
} from "./workspace-template.js";

/** The template tree, exhaustively. Adding a file is a deliberate change to this list. */
const EXPECTED_TREE = [
  "README.md",
  "claude/agents/.gitkeep",
  "claude/skills/comment/SKILL.md",
  "claude/skills/orchestrate/SKILL.md",
  "data/docs/inbox/.gitkeep",
  "data/docs/templates/note.md",
  "data/docs/views/attention.md",
  "data/docs/views/inbox.md",
  "data/docs/views/open-threads.md",
  "data/threads/.gitkeep",
  "gitignore",
];

/** SPEC.md §9.2 `GET /api/docs` parameters — the vocabulary a seed view's query may use. */
const DOCS_QUERY_PARAMS = [
  "q",
  "type",
  "status",
  "tag",
  "folder",
  "parent",
  "references",
  "agent",
  "author",
  "since",
  "due",
  "stale",
  "unread",
  "needs",
  "sort",
];

/** Uppercase by convention — matching case-insensitively would ban the word "todos". */
const CODE_MARKERS = ["TODO", "FIXME", "XXX"];
const PROSE_MARKERS = ["<placeholder>", "<fill me>", "lorem ipsum"];

const readTemplateFile = (relPath: string): string =>
  readFileSync(path.join(TEMPLATE_ROOT, relPath), "utf8");

const templateFiles = listTemplateFiles();
const documents = loadTemplateDocuments();
const documentsByPath = new Map(documents.map((document) => [document.relPath, document]));

const documentAt = (relPath: string) => {
  const document = documentsByPath.get(relPath);
  if (document === undefined) throw new Error(`no template document at ${relPath}`);
  return document;
};

describe("template tree", () => {
  it("contains exactly the documented tree", () => {
    expect(templateFiles).toEqual(EXPECTED_TREE);
  });

  it("uses no dot-prefixed name other than .gitkeep", () => {
    const dotted = templateFiles
      .flatMap((relPath) => relPath.split("/"))
      .filter((segment) => segment.startsWith("."));
    expect(new Set(dotted)).toEqual(new Set([".gitkeep"]));
  });

  it("contains no placeholder markers", () => {
    for (const relPath of templateFiles) {
      const contents = readTemplateFile(relPath);
      for (const marker of CODE_MARKERS) {
        expect(contents, `${relPath} contains "${marker}"`).not.toContain(marker);
      }
      for (const marker of PROSE_MARKERS) {
        expect(contents.toLowerCase(), `${relPath} contains "${marker}"`).not.toContain(marker);
      }
    }
  });

  it("carries no secrets, tokens, or machine-specific absolute paths", () => {
    for (const relPath of templateFiles) {
      const contents = readTemplateFile(relPath);
      expect(contents, relPath).not.toMatch(/\b(?:secret|bearer)\s*[:=]/i);
      expect(contents, relPath).not.toMatch(/(?:^|\s)\/(?:Users|home)\//);
    }
  });
});

describe("seed documents", () => {
  it("gives every markdown file complete SPEC §5 frontmatter", () => {
    expect(documents.length).toBe(7);
    for (const { relPath, frontmatter } of documents) {
      expect(DocumentIdSchema.safeParse(frontmatter.id).success, `${relPath}: id`).toBe(true);
      expect(typeof frontmatter.type, `${relPath}: type`).toBe("string");
      expect(CORE_DOC_TYPES).toContain(frontmatter.type);
      expect(typeof frontmatter.title, `${relPath}: title`).toBe("string");
      expect(frontmatter.title, `${relPath}: title`).not.toBe("");
      expect(IsoDateTimeSchema.safeParse(frontmatter.created).success, `${relPath}: created`).toBe(
        true,
      );
      expect(IsoDateTimeSchema.safeParse(frontmatter.updated).success, `${relPath}: updated`).toBe(
        true,
      );
      expect(Array.isArray(frontmatter.tags), `${relPath}: tags`).toBe(true);
      expect(frontmatter.status, `${relPath}: status`).toBe("open");
      expect(frontmatter.anchors, `${relPath}: anchors`).toEqual({});
      expect(frontmatter.evergreen, `${relPath}: evergreen`).toBe(true);
    }
  });

  it("gives every document a unique id", () => {
    const ids = documents.map((document) => document.frontmatter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses one fixed authoring timestamp, advanced only where a skill body was rewritten", () => {
    // The tree shares one `created` stamp. `updated` matches it everywhere
    // except the orchestrate skill, whose AGENT-002 body advanced it — the
    // template's own "updated tracks content" rule, applied to itself.
    expect(new Set(documents.map(({ frontmatter }) => frontmatter.created)).size).toBe(1);
    for (const { relPath, frontmatter } of documents) {
      if (relPath === "claude/skills/orchestrate/SKILL.md") {
        expect(String(frontmatter.updated) > String(frontmatter.created), relPath).toBe(true);
      } else {
        expect(frontmatter.updated, relPath).toEqual(frontmatter.created);
      }
    }
  });
});

describe("seed views", () => {
  const views = documents.filter((document) => document.frontmatter.type === "view");

  it("ships exactly three pinned columns with contiguous order", () => {
    expect(views.length).toBe(3);
    for (const { relPath, frontmatter, body } of views) {
      expect(frontmatter.pinned, `${relPath}: pinned`).toBe(true);
      expect(Number.isInteger(frontmatter.order), `${relPath}: order`).toBe(true);
      expect(body.trim(), `${relPath}: body`).not.toBe("");
    }
    const orders = views.map((view) => view.frontmatter.order).sort();
    expect(orders).toEqual([1, 2, 3]);
  });

  it("queries only with GET /api/docs parameter names", () => {
    for (const { relPath, frontmatter } of views) {
      const query = frontmatter.query;
      expect(typeof query, `${relPath}: query`).toBe("object");
      const keys = Object.keys(query as Record<string, unknown>);
      expect(keys.length, `${relPath}: query is empty`).toBeGreaterThan(0);
      for (const key of keys) expect(DOCS_QUERY_PARAMS, `${relPath}: query.${key}`).toContain(key);
    }
  });

  it("pins the Attention, Inbox and Open threads queries", () => {
    const attention = documentAt("data/docs/views/attention.md").frontmatter;
    expect(attention.order).toBe(1);
    expect(attention.query).toEqual({ needs: "me" });

    const inbox = documentAt("data/docs/views/inbox.md").frontmatter;
    expect(inbox.order).toBe(2);
    expect(inbox.query).toEqual({ folder: "inbox" });

    const openThreads = documentAt("data/docs/views/open-threads.md").frontmatter;
    expect(openThreads.order).toBe(3);
    expect(openThreads.query).toEqual({ type: "thread", status: "open" });
  });

  it("writes folder values with no leading or trailing slash", () => {
    for (const { relPath, frontmatter } of views) {
      const folder = (frontmatter.query as Record<string, unknown>).folder;
      if (folder === undefined) continue;
      expect(folder, `${relPath}: folder`).toMatch(/^[^/].*[^/]$|^[^/]$/);
    }
  });
});

describe("templates", () => {
  it("declares what each template is for", () => {
    const templates = documents.filter((document) => document.frontmatter.type === "template");
    expect(templates.length).toBeGreaterThan(0);
    for (const { relPath, frontmatter } of templates) {
      expect(typeof frontmatter.for, `${relPath}: for`).toBe("string");
    }
    expect(documentAt("data/docs/templates/note.md").frontmatter.for).toBe("note");
  });
});

describe("skills", () => {
  const skills = [
    { name: "orchestrate", relPath: "claude/skills/orchestrate/SKILL.md" },
    { name: "comment", relPath: "claude/skills/comment/SKILL.md" },
  ];

  it.each(skills)("$name carries both frontmatter field sets", ({ name, relPath }) => {
    const { frontmatter } = documentAt(relPath);
    expect(frontmatter.name).toBe(name);
    expect(frontmatter.name).toBe(path.basename(path.dirname(relPath)));
    expect(typeof frontmatter.description).toBe("string");
    expect(frontmatter.description).not.toBe("");
    expect(frontmatter.type).toBe("skill");
    expect(frontmatter.title).toBe(name === "orchestrate" ? "Orchestrate" : "Comment");
  });

  it.each(skills)("$name states the CLI-only invariant", ({ relPath }) => {
    const body = documentAt(relPath).body;
    expect(body).toMatch(/`corpus` CLI/);
    expect(body).toMatch(/never (?:hand-)?edit(?:ed)?\b/i);
  });

  it.each(skills)("$name carries its required section headings", ({ name, relPath }) => {
    const headings = documentAt(relPath)
      .body.split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).toLowerCase());
    const required =
      name === "orchestrate"
        ? [
            "purpose",
            "invariants",
            "the loop",
            "claiming",
            "routing",
            "concurrency",
            "locks",
            "job logs",
            "completing",
            "halt",
            "stewardship",
            "skills",
            "loop breaks",
            "worked example",
          ]
        : ["gather context", "inbox filing", "reply", "forms", "skill genesis", "worked example"];
    for (const keyword of required) {
      expect(
        headings.some((heading) => heading.includes(keyword)),
        `${relPath}: no section for "${keyword}"`,
      ).toBe(true);
    }
  });

  it("leaves queue terminal-state handling to the orchestrate skill", () => {
    expect(documentAt("claude/skills/comment/SKILL.md").body).not.toMatch(
      /corpus queue (?:complete|fail)/,
    );
  });
});

describe("orchestrate skill body", () => {
  const body = documentAt("claude/skills/orchestrate/SKILL.md").body;

  it("carries no skeleton remnants and no dev-harness references", () => {
    for (const marker of ["arrives with agent", "skeleton", "tbd", "<fill", "placeholder"]) {
      expect(body.toLowerCase(), `contains "${marker}"`).not.toContain(marker);
    }
    // The skill is the product's voice: it must not name this repository's
    // spec, guides, issue tracker, or dev-harness skills.
    for (const marker of ["SPEC.md", "CLAUDE.md", "issues/", "/implement", "/decompose"]) {
      expect(body, `contains "${marker}"`).not.toContain(marker);
    }
  });

  it("gives every section a substantive body, not a bare heading", () => {
    const sections = new Map<string, string[]>();
    let current: string | null = null;
    for (const line of body.split("\n")) {
      if (line.startsWith("## ")) {
        current = line.slice(3);
        sections.set(current, []);
      } else if (current !== null) {
        sections.get(current)?.push(line);
      }
    }
    expect(sections.size).toBe(14);
    for (const [heading, lines] of sections) {
      expect(
        lines.join("\n").trim().length,
        `"${heading}" is a heading with no substance`,
      ).toBeGreaterThan(400);
    }
  });

  it("states the non-negotiable commands and rules verbatim", () => {
    const rules = [
      "corpus queue claim-all",
      "corpus queue idle",
      "corpus queue complete",
      "corpus queue fail",
      "corpus queue reap-stale",
      "corpus queue halt",
      "corpus queue resume",
      'corpus job log <eventId> "<line>"',
      "corpus job retry",
      "corpus skill rollback",
      "corpus lock break",
      "corpus lock reap",
      "corpus doc archive",
      "export CORPUS_FROM=agent",
      "--from agent",
      "--reason",
      ".corpus/HALT",
      '{"idle":true,"reason":"timeout"}',
      '{"idle":true,"reason":"halted"}',
      "deferred:",
      "<plugin>.<action>",
      "terminal state",
    ];
    for (const rule of rules) expect(body, `missing "${rule}"`).toContain(rule);
    expect(body).toMatch(/never delete/i);
    expect(body).toMatch(/never guess/i);
    expect(body).toMatch(/never silently completed/i);
  });

  it("forbids every wait besides idle, and practices the prohibition", () => {
    expect(body).toMatch(/`corpus queue idle` is the only wait/i);
    // The prohibition sentence is the single legal mention of sleeping; no
    // other waiting construct may appear anywhere in the body.
    expect(body.match(/\bsleep\b/gi)).toHaveLength(1);
    expect(body).not.toContain("while true");
    expect(body).not.toMatch(/\bset(?:Timeout|Interval)\b/);
  });

  it("hardwires no plugin name and hedges nothing", () => {
    // The `<plugin>.<action>` routing row is a convention, never an example
    // naming a shipped plugin (sprint-012 adjudication 1).
    expect(body).not.toMatch(/todos|_fixture/i);
    for (const hedge of [
      "use your judgment",
      "consider whether",
      "you may want",
      "if appropriate",
    ]) {
      expect(body.toLowerCase(), `hedges with "${hedge}"`).not.toContain(hedge);
    }
  });

  it("passes every multi-line text argument through a quoted heredoc", () => {
    const heredocs = body.match(/<<-?\s*\S+/g) ?? [];
    expect(heredocs.length).toBeGreaterThan(0);
    for (const heredoc of heredocs) expect(heredoc).toMatch(/^<<'EOF'$/);
    expect(body).not.toMatch(/-m "\$\(/);
  });
});

describe("gitignore", () => {
  const rules = readTemplateFile("gitignore");

  it("ignores .corpus/ runtime state but re-includes the queue skeleton", () => {
    expect(rules).toContain(".corpus/*");
    expect(rules).toContain("!.corpus/queue/");
    expect(rules).toContain(".corpus/queue/*/*.json");
  });
});

/**
 * The generated list mixes three kinds: workspace-relative directories (trailing
 * `/`), workspace-relative files, and bare actions such as `git init`. A path
 * always carries a separator, which is what tells an action apart from a file.
 */
const GENERATED_ACTIONS = INIT_GENERATED.filter((entry) => !entry.includes("/"));
const GENERATED_DIRECTORIES = INIT_GENERATED.filter((entry) => entry.endsWith("/"));
const GENERATED_FILES = INIT_GENERATED.filter(
  (entry) => entry.includes("/") && !entry.endsWith("/"),
);
const GENERATED_PATHS = [...GENERATED_DIRECTORIES, ...GENERATED_FILES];

/** Where every surviving template file lands, in installed-path form. */
const installedTemplatePaths = templateFiles
  .map(installedPath)
  .filter((relPath): relPath is string => relPath !== null);

/** Every directory in the template tree, deepest included, `/`-separated. */
const templateDirectories = [
  ...new Set(
    templateFiles.flatMap((relPath) => {
      const segments = relPath.split("/").slice(0, -1);
      return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
    }),
  ),
].sort();

/**
 * A template directory's installed path, computed by sending a name the copy
 * filter cannot drop through the real `installedPath()`. Re-deriving the rename
 * prefixes here would be a second implementation of the rule under test.
 */
const PROBE_NAME = "probe";
const installedDirectory = (dir: string): string => {
  const probed = installedPath(`${dir}/${PROBE_NAME}`);
  if (probed === null) throw new Error(`the probe name "${PROBE_NAME}" is itself filtered`);
  return `${path.posix.dirname(probed)}/`;
};

describe("install contract", () => {
  const documented = readContractDoc();

  it("agrees with the exported rename table", () => {
    expect(documented.renames).toEqual([...INSTALL_RENAMES]);
  });

  it("agrees with the exported filter list", () => {
    expect(documented.filters).toEqual([...INSTALL_FILTERS]);
  });

  it("agrees with the exported generate-don't-copy list", () => {
    expect(documented.generated).toEqual([...INIT_GENERATED]);
  });

  it("generates directories, files and exactly one action", () => {
    expect(GENERATED_ACTIONS).toEqual(["git init"]);
    expect(GENERATED_DIRECTORIES).toEqual([
      "data/docs/inbox/",
      "data/threads/",
      ".claude/skills-archived/",
      ".claude/agents/",
      ".corpus/queue/",
      ".corpus/locks/",
      ".corpus/jobs/",
      ".corpus/attachments/",
    ]);
    expect(GENERATED_FILES).toEqual([".corpus/config.json", ".corpus/template-manifest.json"]);
  });

  it("names every generated path relative to the workspace root", () => {
    for (const entry of [...GENERATED_DIRECTORIES, ...GENERATED_FILES]) {
      expect(entry, `${entry}: absolute`).not.toMatch(/^\//);
      expect(entry, `${entry}: backslash`).not.toContain("\\");
      expect(entry.split("/"), `${entry}: traversal`).not.toContain("..");
    }
  });

  it("generates nothing the copy already installs", () => {
    for (const file of GENERATED_FILES) {
      expect(installedTemplatePaths, `${file} is both copied and generated`).not.toContain(file);
    }
    for (const directory of GENERATED_DIRECTORIES) {
      const inside = installedTemplatePaths.filter((relPath) => relPath.startsWith(directory));
      expect(inside, `${directory} receives copied files`).toEqual([]);
    }
  });

  it("generates every template directory the copy filter empties", () => {
    // A directory whose every entry is dropped installs to nothing, so it has to
    // be created outright or it is simply missing from the workspace. This is the
    // general form of sprint-003 Open Conflict 9.
    const emptied = templateDirectories.filter((dir) =>
      templateFiles
        .filter((relPath) => relPath.startsWith(`${dir}/`))
        .every((relPath) => installedPath(relPath) === null),
    );
    expect(emptied, "no template directory is emptied by the filter").not.toEqual([]);
    expect(emptied).toContain("claude/agents");
    for (const dir of emptied) {
      expect(
        GENERATED_DIRECTORIES,
        `${dir} installs to nothing and is not generated either`,
      ).toContain(installedDirectory(dir));
    }
  });

  it("generates the roots the template cannot carry at all", () => {
    // `.claude/skills-archived/` has no template counterpart whatsoever, yet it is
    // one of the projection's document roots (SPEC.md §4, §7).
    expect(templateFiles.some((relPath) => relPath.startsWith("claude/skills-archived/"))).toBe(
      false,
    );
    expect(GENERATED_DIRECTORIES).toContain(".claude/skills-archived/");
  });

  it("accounts for every directory `corpus init` creates", () => {
    // Exhaustiveness, stated as a covering rule: a created directory is accounted
    // for when the copy fills it, when a listed entry lives in it, or when it is
    // (or sits inside) a listed directory. Anything left over is created by
    // `init` and invisible to `corpus workspace upgrade`.
    const uncovered = WORKSPACE_DIRECTORIES.filter((dir) => {
      const prefix = `${dir}/`;
      if (installedTemplatePaths.some((relPath) => relPath.startsWith(prefix))) return false;
      if (GENERATED_PATHS.some((entry) => entry.startsWith(prefix))) return false;
      return !GENERATED_DIRECTORIES.some((entry) => prefix.startsWith(entry));
    });
    expect(uncovered, "created by `corpus init`, absent from the install contract").toEqual([]);
  });

  it("lists nothing `corpus init` does not create", () => {
    for (const directory of GENERATED_DIRECTORIES) {
      expect(WORKSPACE_DIRECTORIES, `${directory} is documented but never created`).toContain(
        directory.slice(0, -1),
      );
    }
    for (const file of GENERATED_FILES) {
      expect(WORKSPACE_DIRECTORIES, `${file}'s parent is never created`).toContain(
        path.posix.dirname(file),
      );
    }
  });

  it("lists its directories in `corpus init`'s creation order", () => {
    const created = WORKSPACE_DIRECTORIES.filter((dir) =>
      GENERATED_DIRECTORIES.includes(`${dir}/`),
    );
    expect(GENERATED_DIRECTORIES.map((entry) => entry.slice(0, -1))).toEqual(created);
  });

  it("documents the manifest with the shape `corpus init` writes", () => {
    const doc = readFileSync(CONTRACT_DOC_PATH, "utf8");
    const shape = /```json\n([\s\S]*?)```/.exec(doc)?.[1];
    expect(shape, "no fenced json manifest shape").toBeDefined();
    const parsed: unknown = JSON.parse(shape ?? "");
    expect(Object.keys(parsed as Record<string, unknown>)).toEqual([
      "version",
      "tool",
      "installedAt",
      "files",
    ]);
    const { version, files } = parsed as { version: unknown; files: unknown[] };
    expect(version).toBe(1);
    expect(Object.keys(files[0] as Record<string, unknown>)).toEqual(["path", "sha256"]);
  });

  it("maps every template path to its installed path", () => {
    expect(installedPath("claude/skills/comment/SKILL.md")).toBe(".claude/skills/comment/SKILL.md");
    expect(installedPath("gitignore")).toBe(".gitignore");
    expect(installedPath("README.md")).toBe("README.md");
    expect(installedPath("data/docs/views/inbox.md")).toBe("data/docs/views/inbox.md");
    expect(installedPath("claude/agents/.gitkeep")).toBeNull();
    expect(installedPath("data/threads/.gitkeep")).toBeNull();
  });

  it("installs the whole tree without collisions and without dotless leftovers", () => {
    const installed = templateFiles
      .map(installedPath)
      .filter((relPath): relPath is string => relPath !== null);
    expect(new Set(installed).size).toBe(installed.length);
    expect(installed).toContain(".claude/skills/orchestrate/SKILL.md");
    expect(installed.some((relPath) => relPath.startsWith("claude/"))).toBe(false);
    expect(installed).not.toContain("gitignore");
  });
});

describe("template parsing failures", () => {
  it("rejects a file with no frontmatter fence", () => {
    expect(() => parseFrontmatter("a.md", "just a body\n")).toThrow(TemplateError);
    expect(() => parseFrontmatter("a.md", "just a body\n")).toThrow(/a\.md/);
  });

  it("rejects an unterminated frontmatter block", () => {
    expect(() => parseFrontmatter("b.md", "---\nid: doc_x\n")).toThrow(/unterminated/);
  });

  it("rejects frontmatter that is not a mapping", () => {
    expect(() => parseFrontmatter("c.md", "---\n- one\n- two\n---\nbody\n")).toThrow(
      /not a YAML mapping/,
    );
  });

  it("accepts an empty frontmatter block as an empty mapping", () => {
    expect(parseFrontmatter("d.md", "---\n---\nbody\n")).toEqual({
      relPath: "d.md",
      frontmatter: {},
      body: "body\n",
    });
  });

  it("tolerates a UTF-8 BOM", () => {
    const parsed = parseFrontmatter("e.md", "\uFEFF---\nid: doc_x\n---\nbody\n");
    expect(parsed.frontmatter.id).toBe("doc_x");
  });

  it("rejects duplicate ids in a tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "corpus-template-"));
    try {
      writeFileSync(path.join(root, "one.md"), "---\nid: doc_same\n---\nfirst\n");
      writeFileSync(path.join(root, "two.md"), "---\nid: doc_same\n---\nsecond\n");
      expect(() => loadTemplateDocuments(root)).toThrow(TemplateError);
      expect(() => loadTemplateDocuments(root)).toThrow(/duplicate id doc_same/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores documents with no id when checking uniqueness", () => {
    const root = mkdtempSync(path.join(tmpdir(), "corpus-template-"));
    try {
      writeFileSync(path.join(root, "one.md"), "---\ntitle: no id\n---\nfirst\n");
      writeFileSync(path.join(root, "two.md"), "---\ntitle: also none\n---\nsecond\n");
      writeFileSync(path.join(root, "notes.txt"), "not a document");
      expect(loadTemplateDocuments(root)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a missing contract-document section", () => {
    expect(() => parseContractDoc("# nothing here\n")).toThrow(TemplateError);
    expect(() => parseContractDoc("# nothing here\n")).toThrow(/Renamed on copy/);
  });

  it("stops a contract-document section at the next heading", () => {
    const rules = parseContractDoc(
      [
        "## Renamed on copy",
        "| `a/` | `.a/` |",
        "## Filtered on copy",
        "- `.gitkeep` — kept out",
        "## Generated by `corpus init`, not copied",
        "- `x.json` — made at install time",
        "## After",
        "- `y.json` — not part of any list",
      ].join("\n"),
    );
    expect(rules).toEqual({
      renames: [{ template: "a/", installed: ".a/" }],
      filters: [".gitkeep"],
      generated: ["x.json"],
    });
  });
});

describe("corpus invocation extraction", () => {
  const surface = parseCliDoc(
    [
      "## `corpus init`",
      "## `corpus queue`",
      "### `corpus queue idle`",
      "## `corpus thread`",
      "### `corpus thread reply`",
    ].join("\n"),
  );

  it("classifies topics and commands from the reference's headings", () => {
    expect([...surface.commands].sort()).toEqual(["init", "queue idle", "thread reply"]);
    expect([...surface.topics].sort()).toEqual(["queue", "thread"]);
  });

  it("rejects a reference with no command headings", () => {
    expect(() => parseCliDoc("# nothing\n")).toThrow(TemplateError);
  });

  it("extracts a fenced multi-line heredoc invocation without its body", () => {
    const markdown = [
      "```bash",
      "corpus thread reply th_4b8e2c --from agent <<'EOF'",
      "corpus queue resume restores it — this line is reply content, not a command.",
      "EOF",
      "corpus queue idle",
      "```",
    ].join("\n");
    expect(extractCorpusInvocations(markdown)).toEqual([
      ["thread", "reply", "th_4b8e2c", "agent"],
      ["queue", "idle"],
    ]);
  });

  it("extracts an inline-code invocation", () => {
    expect(extractCorpusInvocations("Park with `corpus queue idle` between events.")).toEqual([
      ["queue", "idle"],
    ]);
  });

  it("never extracts a prose sentence mentioning corpus", () => {
    expect(extractCorpusInvocations("The corpus CLI is the only interface.\n")).toEqual([]);
    expect(extractCorpusInvocations("corpus init is described elsewhere.\n")).toEqual([]);
  });

  it("extracts a top-level command with no topic", () => {
    const invocations = extractCorpusInvocations("```bash\ncorpus init ~/notes --port 9062\n```");
    // Flags are dropped; bare values (arguments and flag values) survive, and
    // normalization ignores everything after a documented bare command.
    expect(invocations).toEqual([["init", "~/notes", "9062"]]);
    expect(normalizeInvocation(invocations[0] ?? [], surface)).toBe("init");
  });

  it("splits compound shell lines into separate invocations", () => {
    const invocations = extractCorpusInvocations(
      "```bash\ncorpus queue idle && corpus queue claim-all | jq -r '.events[].id'\n```",
    );
    expect(invocations).toEqual([
      ["queue", "idle"],
      ["queue", "claim-all"],
    ]);
  });

  it("normalizes flag-only and undocumented invocations honestly", () => {
    expect(normalizeInvocation([], surface)).toBeNull();
    expect(normalizeInvocation(["queue"], surface)).toBe("queue");
    expect(normalizeInvocation(["frobnicate"], surface)).toBe("frobnicate");
    expect(normalizeInvocation(["doc", "frobnicate"], surface)).toBe("doc frobnicate");
  });
});

describe("cli command references", () => {
  const surface = readCliDoc();

  /** Every referenced command a surface does not document, allowlist applied. */
  const unresolvedIn = (source: string): string[] =>
    extractCorpusInvocations(source)
      .map((tokens) => normalizeInvocation(tokens, surface))
      .filter((command): command is string => command !== null)
      .filter(
        (command) =>
          !surface.commands.has(command) &&
          !surface.topics.has(command) &&
          !CLI_COMMANDS_PENDING_CLI_006.includes(command),
      );

  it("resolves every `corpus …` invocation in the whole template tree against docs/cli.md", () => {
    for (const relPath of templateFiles.filter((file) => file.endsWith(".md"))) {
      expect(unresolvedIn(readTemplateFile(relPath)), relPath).toEqual([]);
    }
  });

  it("fails on a command docs/cli.md does not document", () => {
    const skill = readTemplateFile("claude/skills/orchestrate/SKILL.md");
    expect(unresolvedIn(`${skill}\nRun \`corpus doc frobnicate doc_a1b2c3\` twice.\n`)).toEqual([
      "doc frobnicate",
    ]);
  });

  it("allowlists nothing, now that CLI-006 has landed", () => {
    // Adjudication 5's hole closed itself: the test below went red when
    // `docs/cli.md` gained the two verbs, and sprint-013 Adjudication 17 emptied
    // both the array and this assertion in the same change.
    expect([...CLI_COMMANDS_PENDING_CLI_006]).toEqual([]);
  });

  it("resolves the two formerly-allowlisted verbs against docs/cli.md itself", () => {
    for (const command of ["doc check", "skill rollback"]) {
      expect(surface.commands.has(command), `\`corpus ${command}\` is documented`).toBe(true);
    }
  });

  it("expires the allowlist the moment CLI-006 lands in docs/cli.md", () => {
    // Self-invalidation (sprint-012 adjudication 5): each allowlisted verb must
    // still be UNdocumented. When CLI-006 ships `corpus doc check` and
    // `corpus skill rollback`, this test fails and the allowlist must be
    // emptied — the hole closes itself.
    for (const command of CLI_COMMANDS_PENDING_CLI_006) {
      expect(
        surface.commands.has(command) || surface.topics.has(command),
        `\`corpus ${command}\` is now documented — empty CLI_COMMANDS_PENDING_CLI_006`,
      ).toBe(false);
    }
  });
});
