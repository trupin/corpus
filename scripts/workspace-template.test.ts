import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CORE_DOC_TYPES, DocumentIdSchema, IsoDateTimeSchema } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  INIT_GENERATED,
  INSTALL_FILTERS,
  INSTALL_RENAMES,
  TEMPLATE_ROOT,
  TemplateError,
  installedPath,
  listTemplateFiles,
  loadTemplateDocuments,
  parseContractDoc,
  parseFrontmatter,
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

  it("uses one fixed authoring timestamp across the tree", () => {
    const stamps = documents.flatMap(({ frontmatter }) => [
      frontmatter.created,
      frontmatter.updated,
    ]);
    expect(new Set(stamps).size).toBe(1);
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

describe("skill skeletons", () => {
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
        ? ["invariants", "loop", "routing", "job logs", "halt", "stewardship", "worked example"]
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

describe("gitignore", () => {
  const rules = readTemplateFile("gitignore");

  it("ignores .corpus/ runtime state but re-includes the queue skeleton", () => {
    expect(rules).toContain(".corpus/*");
    expect(rules).toContain("!.corpus/queue/");
    expect(rules).toContain(".corpus/queue/*/*.json");
  });
});

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
