import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CORE_DOC_TYPES,
  DOC_STATUSES,
  DocumentIdSchema,
  IsoDateTimeSchema,
  KanbanSchema,
} from "@corpus/contract";
import { describe, expect, it } from "vitest";
// Read-only, and deliberately the real thing: `corpus init` creates exactly these
// directories, so importing them is what stops the install contract from drifting
// away from the implementation it documents.
import { WORKSPACE_DIRECTORIES } from "../apps/cli/src/commands/init/scaffold.js";
import { planTemplateInstall } from "../apps/cli/src/template/install.js";
import {
  CLI_COMMANDS_PENDING_CLI_006,
  CONTRACT_DOC_PATH,
  INIT_GENERATED,
  INSTALL_FILTERS,
  INSTALL_RENAMES,
  REPO_ROOT,
  TEMPLATE_ROOT,
  TemplateError,
  WEIGHT_TABLE_HEADER,
  extractCorpusInvocationUses,
  extractCorpusInvocations,
  installedPath,
  isNonDocument,
  isVendored,
  listTemplateFiles,
  loadTemplateDocuments,
  normalizeInvocation,
  parseCliDoc,
  parseContractDoc,
  parseFrontmatter,
  readCliDoc,
  readContractDoc,
  VENDORED_PREFIXES,
  readWeightLevels,
} from "./workspace-template.js";

/** The template tree, exhaustively. Adding a file is a deliberate change to this list. */
const EXPECTED_TREE = [
  "CLAUDE.md",
  "README.md",
  "claude/agents/.gitkeep",
  "claude/skills/asd-ste100/LICENSE",
  "claude/skills/asd-ste100/PROVENANCE.md",
  "claude/skills/asd-ste100/SKILL.md",
  "claude/skills/asd-ste100/examples/before-after.md",
  "claude/skills/asd-ste100/references/writing-rules.md",
  "claude/skills/comment/SKILL.md",
  "claude/skills/comment/references/closure.md",
  "claude/skills/comment/references/fences.md",
  "claude/skills/comment/references/forms.md",
  "claude/skills/comment/references/history.md",
  "claude/skills/comment/references/inbox-filing.md",
  "claude/skills/comment/references/skill-genesis.md",
  "claude/skills/comment/references/worked-examples.md",
  "claude/skills/converse/SKILL.md",
  "claude/skills/orchestrate/SKILL.md",
  "claude/skills/profile/SKILL.md",
  "data/docs/boards/attention.md",
  "data/docs/boards/by-status.md",
  "data/docs/boards/files.md",
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

/** A skill as it reaches a workspace's `.claude/skills/`, whatever tree it came from. */
interface InstalledSkill {
  /** The repo-relative source path — what a failure names. */
  readonly label: string;
  readonly body: string;
}

const templatePlan = planTemplateInstall(TEMPLATE_ROOT);

/**
 * Every skill document `corpus init` installs. The plan is the CLI's real
 * installer rather than a glob re-written here, so a skill added to the template
 * is swept the day it lands.
 *
 * This used to read two trees: the template's own and a plugin's
 * `skills/<name>/`. INFRA-031 deleted `plugins/`, so the template is now the
 * whole of it — which is the point of SHARED-067, that the core is the whole of
 * the product. The rules in "every installed skill" still run over one list.
 */
const installedSkills: readonly InstalledSkill[] = templatePlan
  .filter(
    (file) =>
      file.to.startsWith(".claude/skills/") &&
      file.to.endsWith(".md") &&
      !isVendored(file.from) &&
      !isNonDocument(file.from),
  )
  .map((file) => ({
    label: `assets/workspace/${file.from}`,
    body: documentAt(file.from).body,
  }));

/**
 * The comment skill's `references/` files (AGENT-047): skill payload read on a
 * directed pointer from `SKILL.md`, installed beside it and excluded from the
 * document rules the way the vendored skill's references are — but authored
 * here, so every sweep that binds a skill body's worked commands binds them
 * too. Drawn from the installer's plan for the same reason `installedSkills`
 * is: a reference added to the template is swept the day it lands.
 */
const skillReferences: readonly InstalledSkill[] = templatePlan
  .filter((file) => file.to.startsWith(".claude/skills/comment/references/"))
  .map((file) => ({
    label: `assets/workspace/${file.from}`,
    body: readTemplateFile(file.from),
  }));

/** Every installed skill text — bodies and reference files alike — for the sweeps. */
const installedSkillTexts: readonly InstalledSkill[] = [...installedSkills, ...skillReferences];

/**
 * The comment skill as its subagent can read it: the body plus every reference
 * it points at. Doctrine that moved into a reference (AGENT-047) is still the
 * skill's doctrine — a pin that asks "does the comment skill state this?" asks
 * it of the package, and a pin about *where* a rule sits reads the one file.
 */
const commentPackage = [
  documentAt("claude/skills/comment/SKILL.md").body,
  ...skillReferences.map(({ body }) => body),
].join("\n\n");

/**
 * Every worked turn-writing invocation in a skill body: `--from agent` on a
 * `thread reply`/`thread create` is what marks one.
 */
const turnCommands = (body: string): string[] =>
  body.match(/corpus thread (?:reply|create)\b[^\n]*--from agent[^\n]*/g) ?? [];

interface FencedBlock {
  /** The fence's info string — `bash`, `prompt`, or `""` when it carries none. */
  readonly info: string;
  readonly content: string;
  /** Index of the opening fence line in the body. */
  readonly openLine: number;
}

/** Every fenced block in a markdown body, in document order. Fences never nest. */
const fencedBlocks = (markdown: string): FencedBlock[] => {
  const blocks: FencedBlock[] = [];
  let open: { info: string; openLine: number; lines: string[] } | null = null;
  for (const [index, line] of markdown.split("\n").entries()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (open === null) {
        open = { info: trimmed.slice(3).trim(), openLine: index, lines: [] };
      } else {
        blocks.push({ info: open.info, content: open.lines.join("\n"), openLine: open.openLine });
        open = null;
      }
      continue;
    }
    open?.lines.push(line);
  }
  return blocks;
};

/**
 * A sentence matched across whatever line wrapping the file happens to have.
 * Skill bodies are hand-wrapped at about a hundred columns, so a pin that hard-
 * codes where a phrase breaks turns red the next time somebody adds a word to
 * the paragraph — and a pin a reflow breaks is a pin somebody deletes.
 */
const wrapped = (sentence: string): RegExp =>
  new RegExp(sentence.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(/\s+/g, "\\s+"));

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
    expect(documents.length).toBe(12);
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
    // The tree shares one `created` stamp — the template's authoring date, which
    // a file added later still carries, because the tree is authored as one
    // artifact. `updated` matches it everywhere except the files whose bodies
    // have since been rewritten: the three skills (AGENT-002/AGENT-003/AGENT-025)
    // and the README that AGENT-025 taught about residents. That is the
    // template's own "updated tracks content" rule, applied to itself.
    expect(new Set(documents.map(({ frontmatter }) => frontmatter.created)).size).toBe(1);
    const rewritten = [
      "claude/skills/orchestrate/SKILL.md",
      "claude/skills/comment/SKILL.md",
      "claude/skills/converse/SKILL.md",
      "README.md",
    ];
    for (const { relPath, frontmatter } of documents) {
      if (rewritten.includes(relPath)) {
        expect(String(frontmatter.updated) > String(frontmatter.created), relPath).toBe(true);
      } else {
        expect(frontmatter.updated, relPath).toEqual(frontmatter.created);
      }
    }
  });
});

describe("the vendored controlled-language skill (AGENT-037)", () => {
  const vendoredFiles = [
    "SKILL.md",
    "LICENSE",
    "references/writing-rules.md",
    "examples/before-after.md",
  ];

  /**
   * The harness copy is the pinned one — `.claude/skills/asd-ste100/PROVENANCE.md`
   * names the upstream commit, and INFRA-030 verified that copy against it with
   * `cmp`. Holding the product copy to the harness copy chains to the same
   * commit without this test needing the network.
   *
   * The two trees keep separate copies deliberately (`.claude/` is the dev
   * harness and reaches no user; `assets/workspace/` is the product), so nothing
   * else would notice them drifting apart.
   */
  it.each(vendoredFiles)("ships %s byte-identical to the harness copy", (relPath) => {
    const product = readFileSync(
      path.join(TEMPLATE_ROOT, "claude/skills/asd-ste100", relPath),
      "utf8",
    );
    const harness = readFileSync(
      path.join(REPO_ROOT, ".claude/skills/asd-ste100", relPath),
      "utf8",
    );
    expect(product).toBe(harness);
  });

  it("is excluded from the authored-document rules, and only it", () => {
    // The exclusion has to be narrow: if it ever widened to a tree Corpus
    // authors, those files would silently stop being held to §5 frontmatter and
    // to every rule the installed-skill sweep applies.
    expect(VENDORED_PREFIXES).toEqual(["claude/skills/asd-ste100/"]);
    expect(listTemplateFiles(TEMPLATE_ROOT).filter((relPath) => isVendored(relPath)).length).toBe(
      5,
    );
    expect(documents.some(({ relPath }) => isVendored(relPath))).toBe(false);
  });

  it("carries a provenance note naming the licence and the refresh", () => {
    const provenance = readFileSync(
      path.join(TEMPLATE_ROOT, "claude/skills/asd-ste100/PROVENANCE.md"),
      "utf8",
    );
    expect(provenance).toContain("danyuchn/asd-ste100-skill");
    expect(provenance).toContain("MIT");
    // The one claim neither repository may make, because ASD's dictionary is
    // not redistributable and is deliberately absent.
    expect(provenance).toContain("claim ASD-STE100 compliance");
  });
});

describe("the workspace CLAUDE.md (AGENT-037)", () => {
  const claudeMd = readFileSync(path.join(TEMPLATE_ROOT, "CLAUDE.md"), "utf8");

  /**
   * Read directly, not through {@link loadTemplateDocuments}, because this file
   * deliberately carries **no** frontmatter: the agent reads it as instructions
   * every session, and nothing projects it. Giving it a §5 block to satisfy the
   * loader would put eight lines of YAML at the top of the agent's own rules.
   */
  it("carries no frontmatter, and is excluded for that reason", () => {
    expect(isNonDocument("CLAUDE.md")).toBe(true);
    expect(claudeMd.startsWith("---")).toBe(false);
    expect(documents.some(({ relPath }) => relPath === "CLAUDE.md")).toBe(false);
    // README.md is the counterexample the exclusion must not swallow: seed
    // content a person opens in the board, and it keeps its frontmatter.
    expect(isNonDocument("README.md")).toBe(false);
  });

  /**
   * A skill fires when something invokes it, and this one's triggers are
   * on-demand. The file alone is inert; this paragraph is what makes the rule
   * standing, which is the whole point of AGENT-037 and of INFRA-030 before it.
   */
  it("makes the skill standing rather than on-demand", () => {
    expect(claudeMd).toContain(".claude/skills/asd-ste100/SKILL.md");
    expect(claudeMd).toContain("STE-flavored");
    expect(claudeMd).toMatch(/standing rule, not a skill you wait to be asked for/);
  });

  /**
   * AGENT-048: the skill body is 3,366 tokens per context and this digest is
   * 891 already paid in every one (SHARED-070, rank 2 at ~111k tokens/day).
   * The standing rule stands — what changed is which text carries it. The
   * digest is the whole obligation for ordinary writing; the skill body is
   * opened only on its own triggers, or for a rewrite that needs the
   * dictionary-level rules and the scan checklist.
   */
  it("makes the digest the rule, and the skill body a directed read", () => {
    expect(claudeMd).toMatch(/This digest is the rule, not a summary of one you still owe a read/);
    expect(claudeMd).toMatch(/you do not open the skill file to follow them/);
    expect(claudeMd).toMatch(/exactly two cases/);
    // The wording must not read as licence to skip the rules themselves.
    expect(claudeMd).toMatch(/Skipping the read never means skipping the rules/);
  });

  /**
   * The two exemptions that carry the real risk, pinned separately because they
   * fail in opposite directions. Dropping the quotation rule corrupts what
   * somebody else wrote — the one failure a reader cannot see. Dropping the
   * hedge rule turns a qualified statement into a different claim, which the
   * skill itself calls the most common way a well-meant rewrite goes wrong.
   */
  it("exempts quotations from the rule", () => {
    expect(claudeMd).toMatch(/never rewrite a quotation/i);
    expect(claudeMd).toContain("a person's own words");
    expect(claudeMd).toContain("an error string the server returned");
  });

  it("keeps a hedge at its original strength", () => {
    expect(claudeMd).toContain("`may have failed` never becomes `failed`");
    expect(claudeMd).toMatch(/different claim/);
  });

  /**
   * The rule governs what the agent writes to a person, so the surfaces that
   * have to obey it are the **worked reply examples** — what an agent copies —
   * and not the skills' own instructional prose, which is written for the agent.
   *
   * This pin exists because AGENT-035 shipped 34 examples using `EOF` beside one
   * paragraph saying `CORPUS_EOF`, and an example beats a paragraph. Two shipped
   * reply bodies carried a semicolon, which STE Rule 8.1 bans outright rather
   * than only as a clause join.
   */
  it.each(installedSkillTexts)(
    "$label models no reply a person reads with a semicolon",
    ({ body }) => {
      // Scoped to `thread reply` deliberately. Those are the turns CLAUDE.md names
      // first, and they are unambiguously "text you produce for a person". A
      // document body the agent authors is also read by a person, and three of
      // them carry a semicolon today — but a document is a different genre from a
      // reply, and settling that is not this issue's to do. It is worth settling.
      const replies = [
        ...body.matchAll(/corpus thread reply[^\n]*<<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF/g),
      ].map(([, payload]) =>
        // The trace is the reply's final line and is an **action report**, not
        // prose: it has its own conventions, and `to 6.4%; resolved this thread`
        // is pinned elsewhere as the shape that keeps a state change out of a
        // second reporting convention. The rule under test is about the sentences
        // a person reads above it.
        (payload ?? "")
          .split("\n")
          .filter((line) => !line.startsWith("↳ "))
          .join("\n"),
      );
      for (const payload of replies) {
        expect(payload).not.toContain(";");
      }
    },
  );

  it("states the cost the user accepted rather than denying it", () => {
    // The user chose "everything the agent writes" knowing the skill warns
    // against applying STE where voice is the point. A file that omitted the
    // cost would be quietly re-deciding that.
    expect(claudeMd).toMatch(/flatter than one written for voice/);
  });
});

describe("seed views", () => {
  const views = documents.filter((document) => document.frontmatter.type === "view");

  /**
   * SPEC.md §10, rider 2 (signed 2026-08-22): "A view document is a saved query
   * and nothing more: it has no `pinned` and no `order`." Both keys were removed
   * from the product rather than deprecated, so a seed still carrying one is a
   * seed teaching a shape the tool has stopped reading — and, worse, one that
   * would make `corpus upgrade` report a migration against a brand-new
   * workspace (CLI-061's `views-to-board` fires on exactly `pinned`/`order`).
   */
  it("ships exactly three saved queries, with no place of their own", () => {
    expect(views.length).toBe(3);
    for (const { relPath, frontmatter, body } of views) {
      expect("pinned" in frontmatter, `${relPath}: carries pinned`).toBe(false);
      expect("order" in frontmatter, `${relPath}: carries order`).toBe(false);
      expect(body.trim(), `${relPath}: body`).not.toBe("");
    }
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

  it("ships the Attention, Inbox and Open threads queries", () => {
    expect(documentAt("data/docs/views/attention.md").frontmatter.query).toEqual({ needs: "me" });
    expect(documentAt("data/docs/views/inbox.md").frontmatter.query).toEqual({ folder: "inbox" });
    expect(documentAt("data/docs/views/open-threads.md").frontmatter.query).toEqual({
      type: "thread",
      status: "open",
    });
  });

  it("writes folder values with no leading or trailing slash", () => {
    for (const { relPath, frontmatter } of views) {
      const folder = (frontmatter.query as Record<string, unknown>).folder;
      if (folder === undefined) continue;
      expect(folder, `${relPath}: folder`).toMatch(/^[^/].*[^/]$|^[^/]$/);
    }
  });
});

/**
 * SPEC.md §10, rider 2 and rider 6 (both signed 2026-08-22). "The seed ships
 * three boards — Attention, a kanban over `status`, and Files — and no board is
 * hardwired." A board is an ordinary `type: board` document, so what these pin
 * is what the *bytes* say: nothing in the product may hardwire these ids, and
 * nothing in the product creates a board for a workspace that has one.
 */
describe("seed boards", () => {
  const boards = documents.filter((document) => document.frontmatter.type === "board");
  const columnsOf = (relPath: string): unknown => documentAt(relPath).frontmatter.columns;

  it("ships exactly three boards, each with a body and a distinct place", () => {
    expect(boards.length).toBe(3);
    for (const { relPath, body } of boards) {
      expect(relPath.startsWith("data/docs/boards/"), `${relPath}: not under boards/`).toBe(true);
      expect(body.trim(), `${relPath}: body`).not.toBe("");
    }
    const orders = boards.map((board) => board.frontmatter.order).sort();
    expect(orders).toEqual([1, 2, 3]);
  });

  it("puts the three seed views on the Attention board, in order", () => {
    const attention = documentAt("data/docs/boards/attention.md").frontmatter;
    expect(attention.id).toBe("doc_seedboardattention");
    expect(attention.order).toBe(1);
    // Rider 2: a column is a line in a board document, and the order *is* the
    // value. Written out rather than derived, so reordering the seed views'
    // files cannot silently reorder the shipped board.
    expect(attention.columns).toEqual([
      "doc_seedattention",
      "doc_seedinbox",
      "doc_seedopenthreads",
    ]);
  });

  it("names only view documents that ship, on every board that names any", () => {
    const viewIds = new Set(
      documents
        .filter((document) => document.frontmatter.type === "view")
        .map((document) => document.frontmatter.id),
    );
    for (const { relPath, frontmatter } of boards) {
      const columns = frontmatter.columns;
      if (columns === undefined) continue;
      expect(Array.isArray(columns), `${relPath}: columns`).toBe(true);
      for (const id of columns as unknown[]) {
        expect(viewIds, `${relPath}: column ${String(id)} names no seed view`).toContain(id);
      }
    }
  });

  /**
   * Rider 6, and the distinction CLI-060 measured: **omitting `transitions` is
   * the linear funnel, `{}` is a graph nothing may be dragged along**. The seed
   * wants the funnel, so the key must be *absent* — `toEqual({})` would pass on
   * either shape, which is why absence is asserted on its own.
   */
  it("draws the kanban over status, as the linear funnel", () => {
    const board = documentAt("data/docs/boards/by-status.md").frontmatter;
    expect(board.id).toBe("doc_seedboardbystatus");
    expect(board.order).toBe(2);
    expect(board.query).toEqual({ type: "note" });
    // A kanban's columns are derived one per stage and are not view documents,
    // so the key is absent rather than empty (`columns: []` is the Files board).
    expect("columns" in board, "by-status carries a columns key").toBe(false);
    const kanban = KanbanSchema.safeParse(board.kanban);
    expect(kanban.success ? "" : JSON.stringify(kanban.error?.issues)).toBe("");
    expect(kanban.success && kanban.data.field).toBe("status");
    expect(kanban.success && kanban.data.stages).toEqual([...DOC_STATUSES]);
    const raw = board.kanban as Record<string, unknown>;
    expect("transitions" in raw, "the seed kanban writes a transition graph").toBe(false);
  });

  it("ships the Files board empty, and it is the one that opens", () => {
    const files = documentAt("data/docs/boards/files.md").frontmatter;
    expect(files.id).toBe("doc_seedboardfiles");
    expect(files.order).toBe(3);
    // Empty, not absent: rider 2's Files board has no query columns, while a
    // kanban has no `columns` key at all. The two states are different.
    expect(files.columns).toEqual([]);
    expect(files["default-open"]).toBe(true);
  });

  it("carries `default-open` on exactly one board", () => {
    const open = boards.filter((board) => board.frontmatter["default-open"] === true);
    expect(open.map((board) => board.relPath)).toEqual(["data/docs/boards/files.md"]);
  });

  it("writes the board keys as the file spells them", () => {
    // `default-open`, never `defaultOpen`: the wire spelling is reserved and
    // deliberately unread on disk, so a camel-cased seed would install a board
    // whose flag nothing sees (apps/server/src/core/board-frontmatter.ts).
    for (const { relPath, frontmatter } of boards) {
      expect(frontmatter, `${relPath}: wire spelling on disk`).not.toHaveProperty("defaultOpen");
      expect("pinned" in frontmatter, `${relPath}: carries pinned`).toBe(false);
    }
    expect(columnsOf("data/docs/boards/attention.md")).toBeDefined();
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
  /**
   * The two skills that carry the loop's doctrine in full, and against which
   * every rule below about *how a rule is worded* is pinned.
   *
   * `converse` is deliberately not in this list (AGENT-025). It is a core skill
   * — it ships, it is checked by `coreSkills` and by the `installedSkills`
   * sweep, and it has its own `describe` block — but it states the reply
   * grammar, the key loop, the patch choice and the fence rules **by reference**
   * to the comment skill rather than restating them, which is the design the
   * issue asked for: three copies of one doctrine is three things to keep in
   * step. Adding it here would demand those copies.
   */
  const skills = [
    { name: "orchestrate", relPath: "claude/skills/orchestrate/SKILL.md" },
    { name: "comment", relPath: "claude/skills/comment/SKILL.md" },
  ];

  /** Every skill the template itself ships — the checks that bind any skill, doctrine or not. */
  const coreSkills = [
    ...skills,
    { name: "converse", relPath: "claude/skills/converse/SKILL.md" },
    { name: "profile", relPath: "claude/skills/profile/SKILL.md" },
  ];

  /**
   * What each doctrine skill *states*, wherever it states it. AGENT-047 moved
   * the comment skill's rare-path accounts — the revert loop above all — into
   * `references/` files its body points at, so a pin asking "does the comment
   * skill still teach this?" reads the package; `orchestrate` still carries
   * everything in its body. Pins about *placement* keep naming one file.
   */
  const skillDoctrine = [
    { name: "orchestrate", text: documentAt("claude/skills/orchestrate/SKILL.md").body },
    { name: "comment", text: commentPackage },
  ];

  it.each(coreSkills)("$name carries both frontmatter field sets", ({ name, relPath }) => {
    const { frontmatter } = documentAt(relPath);
    expect(frontmatter.name).toBe(name);
    expect(frontmatter.name).toBe(path.basename(path.dirname(relPath)));
    expect(typeof frontmatter.description).toBe("string");
    expect(frontmatter.description).not.toBe("");
    expect(frontmatter.type).toBe("skill");
    expect(frontmatter.title).toBe(name[0]?.toUpperCase() + name.slice(1));
  });

  it.each(coreSkills)("$name states the CLI-only invariant", ({ relPath }) => {
    const body = documentAt(relPath).body;
    expect(body).toMatch(/`corpus` CLI/);
    expect(body).toMatch(/never (?:hand-)?edit(?:ed)?\b/i);
  });

  /**
   * SHARED-067 removed the plugin system from the product, so no skill may
   * teach an agent to reach for one. The word itself is the pin: there is no
   * installed `.claude/skills/<plugin>/` to route into, no `/api/x/` space to
   * call, and a skill that named either would send a real workspace's agent
   * after something that is not there. What the removal did **not** take with
   * it is pinned in `orchestrate skill body` → *an event type with no row*.
   */
  it.each(coreSkills)("$name names no plugin surface", ({ relPath }) => {
    const body = documentAt(relPath).body;
    expect(body).not.toMatch(/\bplug-?ins?\b/i);
    expect(body).not.toContain("/api/x/");
  });

  /**
   * AGENT-045. `corpus <verb> --help=brief` prints the synopsis and one line per
   * argument and flag and nothing else — measured at 5,023 words against 25,687
   * over the twenty-five verbs these skills name, an 80% saving. A register
   * nothing asks for saves nothing, so every skill that talks to the CLI
   * conversationally has to name it.
   *
   * `profile` deliberately names neither register, and that is a decision rather
   * than an oversight. It runs seven verbs and spells every one of them out with
   * the flags it needs, so a line sending its agent to look a command up would
   * be sending it to read help it is already holding. If a later profile skill
   * grows a reason to look something up, this is where it says so.
   */
  it("asks for the brief help register in every skill that reaches for help", () => {
    for (const name of ["orchestrate", "comment", "converse"] as const) {
      const relPath = `claude/skills/${name}/SKILL.md`;
      expect(
        documentAt(relPath).body,
        `${relPath}: reaches for help without naming --help=brief`,
      ).toContain("--help=brief");
    }
    expect(
      documentAt("claude/skills/profile/SKILL.md").body,
      "profile now sends its agent to read help it already holds — see the note above",
    ).not.toContain("--help");
  });

  it.each(coreSkills)("$name carries its required section headings", ({ name, relPath }) => {
    const headings = documentAt(relPath)
      .body.split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).toLowerCase());
    const requiredBySkill: Record<string, readonly string[]> = {
      orchestrate: [
        "purpose",
        "invariants",
        "command's help",
        "the loop",
        "claiming",
        "routing",
        "delegation",
        "user edit",
        "reflecting on the corpus",
        "concurrency",
        "writing a document",
        "job logs",
        "completing",
        "halt",
        "stewardship",
        "skills",
        "loop breaks",
        "worked example",
      ],
      comment: [
        // "worked example" left this list with AGENT-047: the four worked
        // events live in `references/worked-examples.md`, pointed at from
        // "When this runs", and the reference describe pins them there.
        "gather context",
        "inbox filing",
        "reply",
        "forms",
        "skill genesis",
      ],
      converse: [
        "purpose",
        "invariants",
        "differently",
        "starting up",
        "the loop",
        "scope",
        "inline",
        "delegating",
        "settling",
        "provenance",
        "summoned",
        "lapse",
        "context runs heavy",
        "retirement",
        "worked example",
      ],
      profile: [
        "when this runs",
        "before you write",
        "worth having",
        "writing it",
        "refusals",
        "reporting",
        "worked example",
      ],
    };
    const required = requiredBySkill[name] ?? [];
    expect(required.length, `${relPath}: no required-heading list for "${name}"`).toBeGreaterThan(
      0,
    );
    for (const keyword of required) {
      expect(
        headings.some((heading) => heading.includes(keyword)),
        `${relPath}: no section for "${keyword}"`,
      ).toBe(true);
    }
  });

  /**
   * The `↳` trace convention (SPEC.md §6): an agent turn that performed writes
   * closes with `↳ <past-tense action report>` as its **final** line. Both
   * skills state it, and both practice it in their worked examples — a reply
   * that changed nothing carries none.
   */
  describe("trace lines", () => {
    it.each(skills)("$name states the trace grammar", ({ relPath }) => {
      const body = documentAt(relPath).body;
      expect(body).toContain("↳ ");
      expect(body).toMatch(/past-tense/i);
      expect(body).toMatch(/final line — and only its final line —/);
      expect(body).toMatch(/changed nothing/i);
    });

    it.each(skills)("$name puts a trace last, or not at all", ({ relPath }) => {
      const lines = documentAt(relPath).body.split("\n");
      const traceLines = lines.filter((line) => line.trimStart().startsWith("↳"));
      expect(traceLines.length, `${relPath}: no worked-example trace`).toBeGreaterThan(0);
      for (const [index, line] of lines.entries()) {
        if (!line.trimStart().startsWith("↳")) continue;
        // Every trace written into an example turn is that turn's last line:
        // the heredoc terminator is what comes next.
        expect(lines[index + 1]?.trim(), `${relPath}: trace not last in its turn`).toBe(
          "CORPUS_EOF",
        );
      }
    });

    it.each(skills)("$name neither hides the arrow nor dresses it up", ({ relPath }) => {
      const body = documentAt(relPath).body;
      // The arrow is written into the turn's bytes. The reader's `::before` is
      // an implementation detail the skill must not depend on or contradict.
      expect(body).not.toMatch(/omit the arrow/i);
      expect(body).not.toMatch(/::before/);
      expect(body).not.toMatch(/<span[^>]*>\s*↳/);
    });

    it("keeps traces out of user-authored turns", () => {
      // A user turn never carries one (the composer produces none, and the
      // renderer short-circuits on the author), so no example may show one.
      for (const { relPath } of skills) {
        const body = documentAt(relPath).body;
        const userTurns = body
          .split("\n")
          .filter((line) => /^(?:user|##\s*user)\b/i.test(line.trimStart()));
        for (const line of userTurns) expect(line, relPath).not.toContain("↳");
      }
      // Both skills' traces live inside `--from agent` reply heredocs only.
      const orchestrate = documentAt("claude/skills/orchestrate/SKILL.md").body;
      expect(orchestrate).toMatch(/nothing changed, so that reply carries no trace line/);
    });
  });

  /**
   * Copyable canvases (SPEC.md §10, rider signed 2026-08-02): the reader draws
   * every fenced block in a rendered turn with a copy button and its info string
   * as the label. The skills' half of that contract is the authoring rule —
   * text the person is expected to lift and reuse elsewhere is emitted alone
   * inside a labeled fence, so the button lands on exactly the deliverable.
   */
  describe("deliverable fences", () => {
    it.each(skills)("$name states the labeled-fence convention", ({ relPath }) => {
      const body = documentAt(relPath).body;
      expect(body).toMatch(/info string/);
      expect(body).toMatch(/copyable canvas/);
      expect(body).toMatch(/one deliverable per fence/i);
      // The label vocabulary is a convention, shown by example, never a closed
      // list the agent has to match.
      expect(body).toMatch(/`prompt`/);
      expect(body).toMatch(/`command`/);
    });

    /**
     * AGENT-012 (widening) and AGENT-016 (own-line closing) are the two failures
     * of one mechanism, so both skills state the mechanism once and derive both.
     * AGENT-016's half is pinned **with its cost**, because a rule whose reason is
     * invisible gets optimised away: a fence closed on the content line never
     * closes, and `turns.ts` excludes fenced regions from delimiter scanning, so
     * every later turn heading is swallowed and the next person's message
     * disappears from the conversation with no error anywhere.
     */
    it.each(skills)("$name states both halves from one mechanism", ({ relPath }) => {
      const body = documentAt(relPath).body;
      expect(body).toMatch(/closes only on a line that is nothing but backticks/i);
      expect(body).toMatch(/wider than anything inside/i);
      expect(body).toMatch(/longest backtick run in the payload/i);
      expect(body).toMatch(/on a line of its own/i);
      // The consequence, never the mere fact of malformed markup.
      expect(body).toMatch(/closes nothing/i);
      expect(body).toMatch(/heading \*{0,2}inside a fence is (?:deliberately )?not a delimiter/i);
      expect(body).toMatch(/swallow/i);
      expect(body).toMatch(/no error anywhere|nothing anywhere reports an error/i);
    });

    it("spells out what an unclosed fence costs the reader", () => {
      // The consequence is inline — a subagent that skips the reference still
      // reads what the failure does — and the mechanical fix lives with the
      // worked shapes in the fences reference (AGENT-047).
      const body = documentAt("claude/skills/comment/SKILL.md").body;
      expect(body).toMatch(/stays open to the end\s+of the turn/);
      expect(body).toMatch(/absorbed into the body of yours/);
      const reference = readTemplateFile("claude/skills/comment/references/fences.md");
      expect(reference).toMatch(/It does not render badly; it makes the next message vanish/);
      // The fix is mechanical and stated as one: newline, then the run alone.
      expect(reference).toMatch(
        /newline after the\s+payload's last character, then the closing run by itself/,
      );
    });

    it("scopes the rule to lift-and-reuse deliverables only", () => {
      const body = documentAt("claude/skills/comment/SKILL.md").body;
      expect(body).toMatch(/lift and reuse/i);
      // Ordinary writing is explicitly untouched — the rule must not read as
      // "fence everything", which would put a copy button on the prose.
      expect(body).toMatch(/prose stays prose/i);
      expect(body).toMatch(/explaining rather than handing\s+over/i);
    });

    it("shows exactly one worked deliverable, alone in its fence", () => {
      // The worked shape lives in the fences reference (AGENT-047), read
      // before any fence is written — the skill body states the rule.
      const body = readTemplateFile("claude/skills/comment/references/fences.md");
      const lines = body.split("\n");
      const examples = fencedBlocks(body).filter((block) => block.info === "prompt");
      expect(examples).toHaveLength(1);
      const [example] = examples;
      expect(example?.content.trim(), "the example fence is empty").not.toBe("");
      // One deliverable per fence: no blank line splitting it into two things.
      expect(example?.content.split("\n").some((line) => line.trim() === "")).toBe(false);
      // Prose outside: the deliverable is introduced from above the fence,
      // never framed by a sentence living inside it.
      const openLine = example?.openLine ?? 0;
      expect(lines[openLine - 1]?.trim()).toBe("");
      expect(lines[openLine - 2]?.trimEnd()).toMatch(/:$/);
    });

    it("keeps orchestrate's copy deferential rather than a second statement of the rule", () => {
      const body = documentAt("claude/skills/orchestrate/SKILL.md").body;
      expect(body).toMatch(/The comment skill states the convention/);
      // It binds the turns orchestrate posts itself, not only dispatched work.
      expect(body).toMatch(/binds\s+the turns you post yourself/);
    });
  });

  /**
   * AGENT-021, SPEC.md §10's rider signed 2026-08-07. CLI-033 made `--model`
   * possible; this is what makes every agent turn actually carry one. The rule
   * is pinned where it decays fastest — in the *examples*, since an example
   * that posts a turn without stating a model teaches the opposite of the rule
   * and beats the rule that contradicts it (AGENT-019's bug survived rewrites
   * exactly that way).
   */
  describe("stating the model that wrote the turn", () => {
    it.each(skills)("$name works at least one turn-writing example", ({ relPath }) => {
      // The per-command `--model` check moved to the installed-skill inventory
      // below, which covers every skill `corpus init` writes into a workspace.
      // What stays here is the obligation that is *these* skills' alone: each
      // has to show the command at all, or the rule holds over an empty set.
      expect(
        turnCommands(documentAt(relPath).body).length,
        `${relPath}: no turn-writing example at all`,
      ).toBeGreaterThan(0);
    });

    it("states the rule, the deciding stage, and the absence, in the comment skill", () => {
      const body = documentAt("claude/skills/comment/SKILL.md").body;
      expect(body).toMatch(/Every reply you post carries `--model <name>`/);
      // What ran, never what was asked for — and why the distinction is
      // load-bearing rather than pedantic: it is what makes "honoured, not
      // weighed again" checkable at all.
      expect(body).toMatch(/what actually ran, never what was asked for/i);
      expect(body).toMatch(/a directive, honoured rather than weighed again/);
      expect(body).toMatch(/the turn is the lasting evidence that it\s+was/);
      // The deciding stage, singular, and never the first stage's.
      expect(body).toMatch(/Where the work ran in stages, name the deciding stage/);
      expect(body).toMatch(/one model,\s+never a list, and never the first stage's/);
      expect(body).toMatch(/gathering stages belong in the job log/);
      // An unknown states nothing. A guess is the failure this whole chain
      // exists to avoid, so the instruction is an omission with one spelling.
      expect(body).toMatch(/When you do not know what ran, leave the flag out entirely/);
      expect(body).toMatch(/a plausible attribution\s+nobody can check is worth less than a blank/);
      expect(body).toMatch(/`--model ""` is a usage error \(exit `2`\)/);
      expect(body).not.toMatch(/best guess/i);
      // A person's turn names no model, and the refusal precedes the body.
      expect(body).toMatch(/refused at exit `2` before the body is read/);
      expect(body).toMatch(/never state a model on a person's behalf/);
    });

    it("carries the same rule into dispatch, in the orchestrate skill", () => {
      const body = documentAt("claude/skills/orchestrate/SKILL.md").body;
      expect(body).toMatch(/\*\*Every turn it posts names the model that wrote it\*\*/);
      expect(body).toMatch(/\*\*record of what ran, never a\s+request for what should run\*\*/);
      expect(body).toMatch(/this turn is the evidence that you did/);
      expect(body).toMatch(/the turn names the \*\*deciding\*\*\s+stage/);
      expect(body).toMatch(/one model and never a list/);
      expect(body).toMatch(/the flag is left out\s+and the turn shows nothing rather than a guess/);
      // The dispatch is what puts the name in the subagent's hand, so it is
      // listed among the things a prompt must carry.
      expect(body).toMatch(/the model you are launching it at/);
      // And the job log is where the split that the turn omits is written down.
      expect(body).toMatch(/\*\*This log is the per-stage account\.\*\*/);
      expect(body).toMatch(/the turn itself names only the\s+deciding stage/);
    });
  });

  /**
   * The rules above are written for the template's two doctrine skills because
   * that is where they were first broken; none of them is *about* those two.
   * Every skill `corpus init` installs sits in the same `.claude/skills/` and is
   * read by the same agent, so every one of them inherits the rules — a sweep
   * that looks at one directory is how AGENT-021's `--model` rule went unheld
   * for a release.
   *
   * So the *file set* is the installer's own plan, and the assertions are not
   * copied. Each core skill keeps its own extra obligation next door — that it
   * shows a turn-writing example, a trace and a heredoc *at all* — which is a
   * demand on a skill that teaches the loop, not on every skill that ships.
   */
  describe("every installed skill", () => {
    it("draws its inventory from the installer, and that inventory posts turns", () => {
      // Anti-vacuity, in both directions this can fail silently: the inventory
      // has to hold at least the doctrine skills the rules were written for, and
      // some skill has to actually post a turn — without which `--model` below
      // would pass by matching nothing at all.
      expect(installedSkills.length).toBeGreaterThanOrEqual(skills.length);
      expect(installedSkills.every((skill) => skill.label.startsWith("assets/workspace/"))).toBe(
        true,
      );
      expect(installedSkills.some((skill) => turnCommands(skill.body).length > 0)).toBe(true);
    });

    it.each(installedSkillTexts)(
      "$label posts no example turn without a model",
      ({ label, body }) => {
        for (const command of turnCommands(body)) {
          expect(command, `${label}: turn written with no model`).toMatch(/ --model \S/);
        }
      },
    );

    it.each(installedSkillTexts)(
      "$label puts a trace last in its turn, or none",
      ({ label, body }) => {
        const lines = body.split("\n");
        for (const [index, line] of lines.entries()) {
          if (!line.trimStart().startsWith("↳")) continue;
          expect(lines[index + 1]?.trim(), `${label}: trace not last in its turn`).toBe(
            "CORPUS_EOF",
          );
        }
      },
    );

    it.each(installedSkillTexts)(
      "$label quotes every heredoc it hands text to",
      ({ label, body }) => {
        // The delimiter, and nothing after it. `\S+` used to swallow whatever
        // touched the token, which made a heredoc *named in prose* — `` `<<'CORPUS_EOF'`
        // `` — read as the unquoted delimiter `<<'CORPUS_EOF'\``. A quoted delimiter is
        // its quotes plus what is inside them; an unquoted one runs to the first
        // space or backtick, so `<<CORPUS_EOF` and `<<"CORPUS_EOF"` still fail
        // below — as does `<<'EOF'`, which is a separate rule with its own pins
        // (PR #50 MAJOR 3): the terminator is a word carried text will not hold.
        for (const heredoc of body.match(/<<-?\s*(?:'[^'\n]*'|"[^"\n]*"|[^\s`]+)/g) ?? []) {
          expect(heredoc, `${label}: unquoted heredoc`).toMatch(/^<<'CORPUS_EOF'$/);
        }
        expect(body, `${label}: command substitution in an argument`).not.toMatch(/-m "\$\(/);
      },
    );
  });

  /**
   * AGENT-022, SPEC.md §7's rider signed 2026-08-11 ("A key, not a lock").
   *
   * The lock did not fail because the code was wrong; it failed because the
   * orchestrate skill told the agent to run `corpus lock acquire` by hand in
   * four places and the agent forgot. So the pins here are about *what the text
   * teaches*, in two directions:
   *
   * - **The removal is a removal.** Not a rewording. There is no verb, no
   *   escape hatch and no recovery advice, because there is nothing to wedge —
   *   and a skill naming a verb the CLI does not have is checked separately by
   *   the invocation extractor, which cannot see prose like "never force a
   *   lock".
   * - **The key is taught as a loop with no extra action in it.** Read → work →
   *   write with the key you were given → keep the key the write returned. The
   *   examples are pinned hardest, because an example that replaces a body with
   *   no `--key` teaches the opposite of the rule and beats the rule that
   *   contradicts it (AGENT-019's bug survived rewrites exactly that way).
   */
  describe("a key, not a lock", () => {
    /** Every `corpus doc edit` in the text that replaces the document's body. */
    const bodyReplacingEdits = (body: string): readonly string[] =>
      [...body.matchAll(/corpus doc edit [^\n`]*/g)]
        .map((match) => match[0])
        .filter((invocation) => /<<'CORPUS_EOF'$|\s-m |\s--file /.test(invocation));

    it.each(installedSkillTexts)("$label names no lock mechanism at all", ({ label, body }) => {
      expect(body, `${label}: names a lock verb`).not.toMatch(/corpus lock\b/);
      expect(body, `${label}: teaches an edit lock`).not.toMatch(/edit lock/i);
      expect(body, `${label}: teaches lock breaking`).not.toMatch(
        /break(?:ing)? a lock|force a lock/i,
      );
      expect(body, `${label}: teaches lock recovery`).not.toMatch(/reap(?:s|ed|ing)? .{0,20}lock/i);
      // `423` was the lock's refusal on every write route; a `409` replaced it.
      expect(body, `${label}: names the lock's status code`).not.toMatch(/\b423\b/);
    });

    it.each(installedSkillTexts)("$label replaces no body without a key", ({ label, body }) => {
      for (const invocation of bodyReplacingEdits(body)) {
        expect(invocation, `${label}: body-replacing edit with no --key`).toMatch(/--key \S/);
      }
    });

    it.each(skills)("$name works a body-replacing edit at all", ({ relPath }) => {
      // Anti-vacuity: the rule above passes trivially on a skill whose examples
      // never replace a body, which is the state this issue found them in.
      expect(bodyReplacingEdits(documentAt(relPath).body).length).toBeGreaterThan(0);
    });

    it("works at least one full key loop, read through fresh key", () => {
      // Anti-vacuity for the assertion above: some example has to actually do
      // it, or "no edit without a key" passes by matching no edits.
      const body = documentAt("claude/skills/comment/SKILL.md").body;
      const loops = body.match(
        /corpus doc show (doc_\w+)\n(?:[^\n]*\n)?key ([0-9a-f]{64})\ncorpus doc edit \1 --key \2/g,
      );
      expect(loops?.length ?? 0).toBeGreaterThan(0);
      // And the fresh key the write hands back, which is what makes a chain of
      // edits cost one read rather than one read per edit.
      expect(body).toMatch(/edited doc_\w+\nkey [0-9a-f]{64}/);
    });

    it.each(skills)("$name teaches the loop rather than a rule to recall", ({ relPath }) => {
      const body = documentAt(relPath).body.replace(/\s+/g, " ");
      expect(body).toMatch(/read → work → write with the key you were given → keep the key/i);
      expect(body).toMatch(/nothing is acquired and nothing is released/i);
    });

    it.each(skills)("$name answers a stale key concretely", ({ relPath }) => {
      const body = documentAt(relPath).body;
      // The two exits an agent branches on, and which of them is a mistake.
      expect(body).toMatch(/exit `2`/i);
      expect(body).toMatch(/exit `9`/i);
      // Not "handle the error": re-read, reconcile, write again — and the
      // refusal already carries what a re-read would have cost.
      expect(body).toMatch(/nothing was written/i);
      expect(body).toMatch(/reconcile/i);
      expect(body).toMatch(/fresh key/);
      expect(body).toMatch(/the mechanism working/);
    });

    it.each(skills)("$name treats the editing signal as a courtesy", ({ relPath }) => {
      const body = documentAt(relPath).body;
      expect(body).toMatch(/someone is editing this/i);
      // The signal must not read as a gate: the write would land, and saying
      // otherwise makes an agent defer where it should write.
      expect(body).toMatch(/would land/);
      expect(body).toMatch(/corpus queue defer|hand the event back/);
    });

    it("keeps the delta verbs free of a key, in both skills", () => {
      for (const { relPath } of skills) {
        const body = documentAt(relPath).body;
        expect(body, `${relPath}: no delta rule`).toMatch(/names its own delta/);
      }
      expect(documentAt("claude/skills/orchestrate/SKILL.md").body).toMatch(/--add-tag/);
    });
  });

  /**
   * SHARED-042, SPEC.md §7's "Loop safety" bullet as amended 2026-08-12.
   *
   * `corpus skill rollback` is deleted rather than fixed: it overwrote a whole
   * file with an old revision and destroyed uncommitted edits at exit 0. There
   * is no replacement verb, because **a revert is a write whose content came
   * from history** — through the ordinary write path it reconciles anchors,
   * validates, commits under the acting party and is protected by the key.
   *
   * So what the skills gain is the teaching the verb stood in for, and — as with
   * AGENT-022 — it has to be a *loop* rather than a command to recall: read the
   * history, work out the content, write it with the key. Three pins here that
   * are easy to lose in a rewrite:
   *
   * - **Reading git is a read.** The agent may run `git log`/`git show`; it may
   *   never write to git, because the server is the sole writer.
   * - **Git hands back the whole file, the write takes the body.** Skipping this
   *   duplicates the frontmatter into the document as text.
   * - **The broken-loop case is the operator's.** No agent is running, so it is
   *   the one path that does not go through the CLI, and the skill must say so
   *   plainly or an agent will try to run a repair it is not alive for.
   */
  describe("a revert is a write like any other", () => {
    it.each(skillDoctrine)("$name teaches the revert as a loop, not a verb", ({ text }) => {
      const body = text;
      const flat = body.replace(/\s+/g, " ");
      expect(flat).toMatch(/a revert is a write whose content came from history/i);
      expect(flat).toMatch(/there is no revert command/i);
      // The three steps, each naming what performs it.
      expect(body).toMatch(/corpus doc diff <id>/);
      expect(body).toMatch(/git log --oneline -- <path>/);
      expect(body).toMatch(/git show <sha>:<path>/);
      expect(flat).toMatch(/content you want back/i);
      expect(flat).toMatch(/rarely the whole old file/i);
    });

    it.each(skillDoctrine)("$name reads git and never writes to it", ({ text }) => {
      const flat = text.replace(/\s+/g, " ");
      expect(flat).toMatch(/read from git, never write to it/i);
      for (const verb of ["git log", "git show", "git checkout", "git restore", "git commit"]) {
        expect(flat, `does not name \`${verb}\``).toContain(`\`${verb}\``);
      }
      expect(flat).toMatch(/sole writer/i);
      // The frontmatter trap: the file in git is not the body the write takes.
      expect(flat).toMatch(/whole file.{0,80}(?:body|write)|body.{0,80}whole file/i);
      expect(flat).toMatch(/closing `---`/);
    });

    it.each(skillDoctrine)("$name says what makes a revert safe", ({ text }) => {
      const flat = text.replace(/\s+/g, " ");
      // Not "be careful": the key of the version just read is presented, so a
      // revert over somebody's newer change is refused rather than landed.
      expect(flat).toMatch(/the key is what makes (?:a|this) revert safe/i);
      expect(flat).toMatch(/version you \*?just read\*?/i);
      expect(flat).toMatch(/exit `9`/);
    });

    it("hands the broken loop to the operator, with git and not the CLI", () => {
      const body = documentAt("claude/skills/orchestrate/SKILL.md").body;
      expect(body).toMatch(/\*This section is for the operator, not the agent\.\*/);
      expect(body).toMatch(/git log --oneline -- \.claude\/skills\/orchestrate\/SKILL\.md/);
      expect(body).toMatch(
        /git restore --source=<sha> -- \.claude\/skills\/orchestrate\/SKILL\.md/,
      );
      // Why it is git here and a CLI write everywhere else.
      const flat = body.replace(/\s+/g, " ");
      expect(flat).toMatch(/one repair that does not go through the agent/i);
      expect(flat).toMatch(/no agent running/i);
      // The trace the operator's edit still leaves (SPEC.md §9.1, SERVER-090).
      expect(flat).toMatch(/out-of-band `user` edit/i);
      // Restore the file, not the commit: a window commit gathers neighbours.
      expect(flat).toMatch(/`git revert <sha>` would take neighbouring documents/i);
      // The halt/resume bracket survives the rewrite.
      expect(body).toMatch(/corpus queue halt/);
      expect(body).toMatch(/corpus queue resume/);
    });

    it("tells the operator the same thing in the workspace README", () => {
      const readme = documentAt("README.md").body;
      expect(readme).toMatch(/git log --oneline -- \.claude\/skills\/orchestrate\/SKILL\.md/);
      expect(readme).toMatch(/git restore --source=<sha>/);
      expect(readme.replace(/\s+/g, " ")).toMatch(/no rollback command/i);
      expect(readme).toMatch(/corpus doc archive/);
    });
  });

  /**
   * AGENT-024, SPEC.md §9.2's patch bullet signed 2026-08-12: _"the agent's
   * skills prefer it over a whole-body edit for bounded changes"_. That sentence
   * is a promise about **this text**, so it is pinned here rather than left to a
   * mention.
   *
   * What decays first in a rewrite is not the verb — it is the three things that
   * make reaching for it a decision rather than a habit:
   *
   * - **The choice rule**, legible without a table: quotable → patch, not
   *   quotable → whole body. Stated with the cost of getting it wrong in *both*
   *   directions, because an agent that only hears "prefer the patch" patches its
   *   way across a document it should have rewritten.
   * - **No key**, as a consequence of the excerpt being the staleness check
   *   (SPEC.md §7) rather than as a flag somebody forgot. Measured: passing
   *   `--key` to `corpus doc patch` is exit 2, unknown flag.
   * - **The two refusals, unblurred.** Same exit `10`, opposite recoveries —
   *   0 matches means re-read, more than one means quote more. An agent that
   *   cannot tell them apart guesses, and both guesses cost a round trip.
   */
  describe("a bounded change is a patch, not a rewrite", () => {
    /**
     * Every `corpus doc patch` invocation in the text, continuation lines
     * included: a patch's excerpts are routinely multi-line, and a single quote
     * left open at the end of a line carries the command onto the next one. Cut
     * at the line would report half a command and pin nothing.
     */
    const patchInvocations = (body: string): readonly string[] => {
      const lines = body.split("\n");
      const invocations: string[] = [];
      for (const [index, line] of lines.entries()) {
        const start = line.indexOf("corpus doc patch ");
        if (start === -1) continue;
        let text = line.slice(start);
        for (let next = index + 1; (text.split("'").length - 1) % 2 === 1; next += 1) {
          const continuation = lines[next];
          if (continuation === undefined) break;
          text += `\n${continuation}`;
        }
        invocations.push(text);
      }
      return invocations;
    };

    /** The ones that actually perform a patch, as opposed to naming the verb in prose. */
    const workedPatches = (body: string): readonly string[] =>
      patchInvocations(body).filter((invocation) => /--(?:old|new)\b/.test(invocation));

    it.each(skills)("$name states the choice as one rule, with both costs", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
      expect(flat).toMatch(
        /a change you can quote is a patch; a change you cannot quote is a whole[- ]body/i,
      );
      // Both directions of the mistake, not only the one the spec names.
      expect(flat).toMatch(/pays the length of the document/i);
      expect(flat).toMatch(/patching what should have been a rewrite/i);
    });

    it.each(skills)("$name works a patch, with both halves of it", ({ relPath }) => {
      // Anti-vacuity: a rule with no worked example is how AGENT-019's bug
      // survived two rewrites — the example is what gets copied.
      const invocations = workedPatches(documentAt(relPath).body);
      expect(invocations.length).toBeGreaterThan(0);
      for (const invocation of invocations) {
        expect(invocation, "a patch with no --old").toMatch(/--old(?:-file)? \S/);
        // `--new` may be empty (`--new ''`), which is how a deletion is spelled.
        expect(invocation, "a patch with no --new").toMatch(/--new(?:-file)? /);
      }
    });

    it.each(skills)("$name presents no key on a patch, and says why", ({ relPath }) => {
      const body = documentAt(relPath).body;
      for (const invocation of patchInvocations(body)) {
        expect(invocation, "a patch carrying a --key").not.toMatch(/--key\b/);
      }
      const flat = body.replace(/\s+/g, " ");
      expect(flat).toMatch(/a patch presents no key/i);
      expect(flat).toMatch(/consequence rather than an omission/i);
      // The excerpt *is* the check — the reason there is nothing to pass.
      expect(flat).toMatch(/staleness check/i);
      // But scoped: it is the check on the text the patch replaces, and the
      // skills must not sell it as a check on the document. Claiming the wider
      // one is what made the changelog append look safe when it was not.
      expect(flat).toMatch(/for the text it replaces|for the text it replaces,/i);
      expect(flat).toMatch(
        /checks nothing it did not quote|covers what you quoted and nothing else/i,
      );
    });

    /**
     * The correction the re-review of AGENT-024 forced. A quote is a check on a
     * **replacement**: it says the text you are replacing is unchanged. An
     * append is an **insertion**, and what would make it wrong — somebody else
     * inserting at the same place first — leaves the quoted text exactly as it
     * was, so the patch applies, splices above their text, and reports success.
     * Both skills must state the rule and both halves of its consequence.
     */
    it.each(skills)("$name says a patch replaces and does not insert", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
      expect(flat).toMatch(/a patch replaces; it does not insert/i);
      // The safe insertion: quote both sides of the gap, so a competing
      // insertion there breaks the quote and is refused.
      expect(flat).toMatch(/quot(?:e|ing) across the gap/i);
      expect(flat).toMatch(/the tail of what comes before and the head of what comes after/i);
      // The unsafe one, named as the case the agent will actually meet, with
      // the write it goes back through instead.
      expect(flat).toMatch(/end of (?:the|a) body/i);
      expect(flat).toMatch(/(?:only check that covers|whose key is the only check)/i);
    });

    it.each(skills)("$name matches byte for byte, body only", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
      expect(flat).toMatch(/byte for byte/i);
      expect(flat).toMatch(/no trimming, no normalisation/i);
      expect(flat).toMatch(/frontmatter block is not part of/i);
      expect(flat).toMatch(/`--new ''` is how a deletion is spelled/);
    });

    it.each(skills)("$name keeps the two refusals apart", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
      expect(flat).toMatch(/exit `10`/);
      expect(flat).toMatch(/matched 0 times/i);
      expect(flat).toMatch(/matched more than once/i);
      // Opposite recoveries, each named where its refusal is.
      expect(flat).toMatch(/re-read (?:it|the document)/i);
      expect(flat).toMatch(/quote more/i);
      // `--all` is not the way out of an ambiguity you did not look at.
      expect(flat).toMatch(/make a refusal go away/i);
      // And exit 9 from this route is a third fact, not one of the two.
      expect(flat).toMatch(/exit `9` from a patch/i);
      expect(flat).toMatch(/wrote the file between the match and the save/i);
    });

    it.each(skillDoctrine)("$name reverts a passage with a patch", ({ text }) => {
      const flat = text.replace(/\s+/g, " ");
      expect(flat).toMatch(/a passage you can quote goes back as a \*?\*?patch/i);
      // The frontmatter trap AGENT-023 measured: a patch quotes body text, so
      // there is no whole file in hand to paste the YAML block back in from.
      expect(flat).toMatch(/cannot make th(?:at|is) mistake/i);
    });

    it("keeps the changelog append on the keyed whole-body path, and says why", () => {
      const skill = documentAt("claude/skills/orchestrate/SKILL.md").body;
      const flat = skill.replace(/\s+/g, " ");
      // AGENT-024 made this a patch and claimed the quote kept it safe. It did
      // not: the changelog is the last thing in the body, so the append has no
      // far side to quote, and a person's entry landing between the read and
      // the write leaves the quoted tail untouched — the patch applies above
      // theirs at exit 0. The key is the only check that covers what the write
      // did not name, so the exception is stated rather than assumed.
      expect(flat).toMatch(/\*\*This is the bounded change that does not go back as a patch\*\*/);
      expect(flat).toMatch(/nothing on its far side to quote/i);
      expect(flat).toMatch(/splicing your entry above theirs and reporting success/i);
      expect(flat).toMatch(/it is still the \*\*last\*\* one/i);
      expect(flat).toMatch(/corpus doc edit doc_a1b2c3 --key <the key that read printed>/);
      // And the rule it defers to is the general one, not a special case.
      expect(flat).toMatch(/the reason is the one \*Writing a document\* gives/i);
      // No patch may creep back into the rule: the paragraphs that carry the
      // append name `corpus doc patch` only to rule it out.
      const rule = /\*\*Append; never rewrite the section\.\*\*[\s\S]*?\*\*Length is never/.exec(
        skill,
      );
      expect(rule, "the append rule lost its surrounding paragraphs").not.toBeNull();
      expect(rule?.[0] ?? "").not.toMatch(/`corpus doc patch/);
    });

    it("tells the comment skill to quote from a read, never from the pack", () => {
      const flat = documentAt("claude/skills/comment/SKILL.md").body.replace(/\s+/g, " ");
      expect(flat).toMatch(/\*\*You are about to quote one\.\*\*/);
      expect(flat).toMatch(/briefing rather than a copy of the document's bytes/i);
      expect(flat).toMatch(/quote from `corpus doc show <id>`, never from the pack/i);
    });
  });

  it("leaves queue terminal-state handling to the orchestrate skill", () => {
    expect(documentAt("claude/skills/comment/SKILL.md").body).not.toMatch(
      /corpus queue (?:complete|fail)/,
    );
  });

  /**
   * AGENT-035 — a `$` in a quoted flag argument is eaten before the CLI runs.
   *
   * Measured against a real workspace on 2026-08-18, and every number below is
   * an observed one rather than an argument:
   *
   * - `--title "… quote, $18,400"` landed as `quote, ,400` under zsh 5.9 and
   *   `quote, 8,400` under bash 3.2 — same command, two different wrong
   *   figures, exit `0` and a commit in both. The bash one is the worse: the
   *   shell splits `$1` from the `8`, and `8,400` is a number nobody queries.
   * - `--title "Ask \`whoami\` first"` landed as the username. A backtick is not
   *   corrupted, it is obeyed.
   * - `--title 'O'Brien's report'` landed as `OBriens report` — **one**
   *   argument, exit `0`, committed, both apostrophes gone. This is the
   *   measurement that decides the guidance: single quotes are not the safe
   *   alternative, they are the same silent defect on a different character,
   *   and an ordinary surname is enough to trigger it.
   *
   * So the rule cannot be a quote to prefer. It is a construction with no
   * character list attached — build the value in a `<<'CORPUS_EOF'` heredoc, pass
   * `"$var"` — and a provenance test for when it applies: text you are carrying
   * over from somebody else, whose characters you did not choose. A title you
   * wrote out of your own vocabulary is left as a literal in the examples, which
   * is the rule being applied rather than an inconsistency.
   *
   * The recovery clause is the load-bearing half. Both quotes also have a loud
   * failure — an unmatched quote, an unexpected end of file — and the reflex
   * repair for a broken single quote is a double quote, which is the silent
   * hole. A skill that only said "mind your quoting" would route an agent from
   * the failure it can see into the one it cannot.
   */
  describe("a person's words never reach the shell as a literal", () => {
    const orchestrate = documentAt("claude/skills/orchestrate/SKILL.md").body;

    it("states what the shell does, in outcomes an agent can recognise", () => {
      const flat = orchestrate.replace(/\s+/g, " ");
      expect(flat).toMatch(/the shell reads every argument before the CLI sees it/i);
      // Both shells, because a rule stated for one leaves the other's — the
      // plausible-looking `8,400` — reading as a correct write.
      expect(flat).toMatch(/positional parameter/i);
      expect(flat).toMatch(/`quote, ,400` under zsh/);
      expect(flat).toMatch(/`quote, 8,400` under bash/);
      // A backtick is executed, not mangled: a different consequence.
      expect(flat).toMatch(/`` `whoami` `` reaches the document as the username/);
      // The measurement that rules out "just use single quotes".
      expect(flat).toMatch(/`--title 'O'Brien's report'`/);
      expect(flat).toMatch(/lands as `OBriens report`/);
      expect(flat).toMatch(/both apostrophes gone/i);
      // And that all of it is invisible afterwards, which is why it is a rule
      // rather than something to watch out for.
      expect(flat).toMatch(/not the confirmation, not the exit code, not the commit/i);
    });

    it("gives one construction and the test for when it applies", () => {
      const flat = orchestrate.replace(/\s+/g, " ");
      expect(flat).toMatch(/never goes on a command line as a literal/i);
      expect(orchestrate).toMatch(/title=\$\(cat <<'CORPUS_EOF'\n/);
      expect(orchestrate).toMatch(/corpus doc edit doc_a1b2c3 --title "\$title" --from agent/);
      // No character list to remember is the whole reason this construction
      // wins over escaping; the skill has to say so, or an agent applies it
      // only to the characters it happens to notice.
      expect(flat).toMatch(/there is no character list to keep in your head/i);
      // Provenance, not inspection: an agent cannot reliably spot a `$`.
      expect(flat).toMatch(/\*\*The test is where the text came from, not what is in it\.\*\*/);
      expect(flat).toMatch(/`--title "Quarterly insurance review"` is fine as it stands/);
      // One rule with the body case as its already-known instance, which is
      // what the issue asked for instead of a second rule that agrees.
      expect(flat).toMatch(/one rule rather than two/i);
    });

    it("says what to do when the shell complains, which is not a double quote", () => {
      const flat = orchestrate.replace(/\s+/g, " ");
      expect(flat).toMatch(
        /\*\*When the shell refuses the line, the answer is never a double quote\.\*\*/,
      );
      expect(flat).toMatch(/nothing ran, so nothing was written and nothing was lost/i);
      expect(flat).toMatch(/a failure you can see turns into one you cannot/i);
    });

    /**
     * PR #50, MAJOR 3. The clause above forbids the reflex repair, so it has to
     * hand over a repair that works — and the case it was reached for is
     * precisely one the capture form can fail on. Measured on this machine,
     * 2026-08-18, `/bin/bash` 3.2.57:
     *
     * ```
     * $ /bin/bash live_bad.sh      # title=$(cat <<'CORPUS_EOF' / O'Brien report / … )
     * live_bad.sh: line 4: unexpected EOF while looking for matching `''
     * live_bad.sh: line 8: syntax error: unexpected end of file
     * exit=2
     * ```
     *
     * PR #50 second review, MINOR 4: the apostrophe is one instance, not the
     * defect. Re-measured the same day against `bash` 3.2.57 and `zsh` 5.9,
     * with the value in a quoted heredoc inside `$( … )` in each case — bash
     * refuses all three and names a different unmatched character each time,
     * zsh takes all three:
     *
     * ```
     * it's here    → bash: unexpected EOF while looking for matching `''   zsh: ok
     * he said "go  → bash: unexpected EOF while looking for matching `"'   zsh: ok
     * a ` tick     → bash: unexpected EOF while looking for matching ``'   zsh: ok
     * ```
     *
     * `IFS= read -r` returned all three byte-exact under both shells, so the
     * repair is general even though the old diagnosis was not. The pin below
     * therefore rejects a cause written as a count of apostrophes: an agent
     * that reads the explanation as the entry condition skips the repair on the
     * two-thirds of cases the sentence left out.
     *
     * One apostrophe in somebody's sentence — *don't*, *it's*, *O'Brien* — is
     * the commonest shape in the class this rule
     * exists for. Told to build the value the same way and resend, an agent
     * loops on an identical parse error with the one repair it would otherwise
     * reach for ruled out. So the clause must name a construction that differs,
     * and `IFS= read -r` does: the same quoted terminator with no command
     * substitution around it, verified against the real CLI under both shells —
     * `created doc_byx5msh7` under bash 3.2 and `created doc_6geg7o33` under zsh
     * 5.9, both titles landing byte-exact with `$`, a backtick and two
     * apostrophes in them.
     *
     * Its boundary is pinned with it, because `IFS= read -r` takes one line and
     * drops the rest at exit `0` — the truncation that disqualified it as the
     * *general* construction. A flag value is one line, so the repair is sound
     * where it is offered; the skill has to say where that stops, or the next
     * rewrite promotes it to the rule and starts truncating bodies.
     */
    it("hands over a repair that is not the construction that just failed", () => {
      const flat = orchestrate.replace(/\s+/g, " ");
      // Not the same lines again: the resend is ruled out as explicitly as the
      // double quote, since a resend is what the old clause prescribed.
      expect(flat).toMatch(/\*\*Nor is it the same lines again\.\*\*/);
      expect(flat).toMatch(/will not clear on a resend/i);
      // The cause, stated so the agent stops treating the refusal as its error
      // — and stated over the whole class, since bash 3.2 refuses a lone `"`
      // and a stray backtick just as it refuses an apostrophe.
      expect(flat).toMatch(/one unbalanced quoting character anywhere in the value/i);
      expect(flat).toMatch(/an apostrophe in `it's`, a lone `"` .{0,40}and a stray backtick/i);
      expect(flat).toMatch(/`zsh` 5\.9 takes all three/);
      // A count is not the entry condition, and reading it as one is how an
      // agent skips the repair on the cases the old sentence left out.
      expect(flat).toMatch(/not about apostrophes and not about counting them/i);
      expect(flat, "the cause is narrowed back to a count").not.toMatch(/odd number of/i);
      // The repair itself, as a copyable line rather than a description.
      expect(orchestrate).toMatch(/^IFS= read -r title <<'CORPUS_EOF'$/m);
      expect(orchestrate).toMatch(/corpus doc edit doc_a1b2c3 --title "\$title" --from agent/);
      // And its boundary, both halves: what it silently does, and the reason
      // the flag case is unaffected by it.
      expect(flat).toMatch(/\*\*That is a repair, not the rule/i);
      expect(flat).toMatch(/takes \*\*one line\*\* and drops anything after it without saying so/);
      expect(flat).toMatch(/never for a value that spans lines/i);
      expect(flat).toMatch(/a body is fed to the command's own heredoc rather than captured/i);
    });

    /**
     * PR #50, MINOR 7. *No character list to keep in your head* is true of every
     * character — `$`, a backtick, a backslash, a `!`, an apostrophe, a quote —
     * and there is exactly one residual, which is a **line** rather than a
     * character. Measured against the real CLI, 2026-08-18: a body carrying a
     * line that is exactly the terminator created `doc_x7nnyouq` with the body
     * cut off at that line, the remainder run as commands (`hello: command not
     * found`), and the document committed. Recorded beside the claim with its
     * repair rather than by weakening the claim, because the claim is what makes
     * the construction worth using and the residual has a one-word fix.
     *
     * PR #50 second review, MAJOR 3: that one-word fix was written as a
     * condition — *when the text you are carrying could contain one, choose a
     * word it cannot* — which hands the case straight back to the inspection
     * the construction exists to replace, three paragraphs after the skill
     * sets the test as provenance rather than content. And the word it shipped
     * as the default was `EOF`, in all 34 heredocs across the four skills,
     * while naming a pasted shell transcript as the arrival vector: the one
     * body of text certain to hold a bare `EOF` line. Reproduced under both
     * shells, 2026-08-18, with a transcript pasted into a captured heredoc:
     *
     * ```
     * $ /bin/bash before.sh   # value carries a line reading exactly EOF
     * before.sh: line 14: EOF: command not found
     * title=[… line one]      # truncated at that line
     * exit=0                  # and /tmp/…/pwned.txt created by carried text
     * ```
     *
     * The fix is unconditional and costs no inspection: one terminator,
     * `CORPUS_EOF`, everywhere, chosen once rather than per message. So the
     * pins below are two — the prose states it as always, and every heredoc in
     * every shipped skill uses it.
     */
    it("names the one residual the construction does not cover", () => {
      const flat = orchestrate.replace(/\s+/g, " ");
      // The totality claim survives — qualified to characters, which is what it
      // was always true of.
      expect(flat).toMatch(/there is no character list to keep in your head/i);
      expect(flat).toMatch(/it is not a character but a \*\*line\*\*/i);
      // What goes wrong, and that it is a successful write rather than a refusal
      // — the reason it cannot be left to the recovery clause above.
      expect(flat).toMatch(/hands the remainder to the shell as commands/i);
      expect(flat).toMatch(/the write still succeeded, exit `0`/i);
    });

    it("fixes the terminator once, with no text to weigh it against", () => {
      const flat = orchestrate.replace(/\s+/g, " ");
      // Unconditional, and naming both words: the one to use and the one the
      // rest of the world's transcripts already end with.
      expect(flat).toMatch(
        /you choose it once, not per message: the terminator is always `CORPUS_EOF`, never `EOF`/i,
      );
      expect(flat).toMatch(/every shell transcript on earth already ends its heredocs with/i);
      // And that choosing per message is the failure, not the fallback — the
      // clause that used to say the opposite.
      expect(flat).toMatch(/weighing it is the inspection this whole construction exists to/i);
      expect(flat, "the terminator is chosen against the text again").not.toMatch(
        /choose a word it cannot|could contain one/i,
      );
    });

    /**
     * The prose above is worth nothing if the examples teach the other word:
     * an example is what gets copied, and 34 of them saying `EOF` beat one
     * paragraph saying `CORPUS_EOF`. Every shipped skill — they install into
     * the same workspace and are read by the same agent.
     */
    it.each(installedSkills)("$label ends every heredoc with CORPUS_EOF", ({ label, body }) => {
      // Not every installed skill has a heredoc, so this pin is a prohibition,
      // and the anti-vacuity for it is the
      // aggregate below plus the per-core-skill count further down.
      //
      // It forbids **every** delimiter but `CORPUS_EOF`, not merely `EOF`, and
      // that is the whole point of the rule it guards (PR #50 third review,
      // MINOR 6). The argument for the change was that the terminator is chosen
      // once and never weighed against the text; a rule that only bans `EOF`
      // lets the next author pick `BODY`, which is weighing it again with one
      // option removed. `apps/cli/src/commands/hygiene.test.ts` already states
      // the stronger predicate for the CLI's own examples, and two rules for one
      // decision is how this release's other six drifts started.
      const openers = [...body.matchAll(/<<-?\s*(?:'([\w]+)'|"([\w]+)"|([A-Za-z_][\w]*))/g)]
        .map(([, quoted, doubleQuoted, bare]) => quoted ?? doubleQuoted ?? bare)
        .filter((delimiter) => delimiter !== "CORPUS_EOF");
      expect(openers, `${label}: opens a heredoc with a delimiter that is not CORPUS_EOF`).toEqual(
        [],
      );
      // The closing half stays keyed on `EOF` alone, deliberately. Once every
      // opener is `CORPUS_EOF`, a closer spelled anything else leaves the
      // heredoc unclosed, which the open/close counter below already fails on.
      // What that counter cannot see is a demonstration opened safely and closed
      // with the forgeable word — a mismatched pair that reads as correct. That
      // is the one shape worth naming, and naming more would mean inventing a
      // list of words this file may not contain in prose.
      expect(
        body.split("\n").filter((line) => line.trim() === "EOF"),
        `${label}: closes a heredoc with a bare EOF line`,
      ).toEqual([]);
    });

    it("has heredocs in the installed skills for that rule to bind", () => {
      const total = installedSkillTexts.reduce(
        (count, skill) => count + (skill.body.match(/<<'CORPUS_EOF'/g)?.length ?? 0),
        0,
      );
      // 34 across the four core skills at the time of the change. A floor, not
      // the count: the pin is that the rule above is checking real examples.
      // (It read 35 until INFRA-031 deleted the todos plugin's own skill;
      // AGENT-047 moved several worked examples into the comment skill's
      // references, so the sweep counts those files too.)
      expect(total).toBeGreaterThanOrEqual(34);
    });

    /**
     * The examples are what get copied, so the rule is pinned in them and not
     * only in the prose. Both sites carry somebody else's words: a standalone
     * thread's real title is made out of the conversation, and the reported
     * defect was exactly a thread title.
     */
    it("builds a thread's title in a heredoc, at both sites that set one", () => {
      // The second site is worked example 2, which AGENT-047 moved into the
      // references — the package is where both sites live now.
      const comment = commentPackage;
      const retitles = [...comment.matchAll(/corpus doc edit th_\w+ --title (\S+)/g)].map(
        (match) => match[1],
      );
      expect(retitles.length, "the comment skill retitles no thread").toBeGreaterThan(1);
      for (const argument of retitles) {
        expect(argument, "a thread title is quoted straight into the command").toBe('"$title"');
      }
      // And the value really is built the safe way ahead of each of them.
      expect(comment.match(/title=\$\(cat <<'CORPUS_EOF'\n/g)?.length ?? 0).toBe(retitles.length);
    });

    it("shows the cost at the site of the reported defect", () => {
      const flat = documentAt("claude/skills/comment/SKILL.md").body.replace(/\s+/g, " ");
      expect(flat).toMatch(/reaches the corpus as `cabinet quote, ,400`/);
      expect(flat).toMatch(/the wrong figure shown to the person who gave you the right one/i);
    });

    it("passes a skill's description by name, like any other prose somebody reads", () => {
      // The creation block lives in the genesis reference (AGENT-047); the
      // package is what the rule binds.
      const comment = commentPackage;
      expect(comment).toMatch(/description=\$\(cat <<'CORPUS_EOF'\n/);
      for (const invocation of comment.match(/corpus skill create [^\n]*/g) ?? []) {
        expect(invocation, "a skill description is quoted straight into the command").toMatch(
          /--description "\$description"/,
        );
      }
    });

    /**
     * A heredoc terminator only closes the heredoc on a line of its own with
     * nothing before it, so an indented example is not an example — it is a
     * command that behaves differently from the one on the page. Measured on
     * the same day: an indented terminator is a parse error under zsh and,
     * under bash, silently swallows the rest of the input into the value. Two
     * shipped examples had one (`comment`'s skill genesis, `converse`'s
     * retirement sign-off); both are now at column zero. The pattern still
     * covers `EOF` as well as `CORPUS_EOF`: an indented one of either closes
     * nothing, and a rewrite that reintroduces the old word should fail here
     * too rather than only where the word itself is pinned.
     */
    it.each(coreSkills)("$name indents no heredoc terminator", ({ relPath }) => {
      const offenders = documentAt(relPath)
        .body.split("\n")
        .filter((line) => /^\s+(?:CORPUS_)?EOF\s*$/.test(line));
      expect(offenders, `${relPath}: an indented terminator closes nothing`).toEqual([]);
    });

    it.each(coreSkills)("$name opens a heredoc it can close", ({ relPath }) => {
      // Anti-vacuity for the rule above, and a real check in its own right:
      // every `<<'CORPUS_EOF'` opened is closed by a bare `CORPUS_EOF` after it.
      const lines = documentAt(relPath).body.split("\n");
      let opened = 0;
      let closed = 0;
      for (const line of lines) {
        if (line.includes("<<'CORPUS_EOF'")) opened += 1;
        else if (line === "CORPUS_EOF") closed += 1;
      }
      expect(opened, `${relPath}: no heredoc to check`).toBeGreaterThan(0);
      expect(closed, `${relPath}: ${opened} heredocs opened, ${closed} closed`).toBe(opened);
    });
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
    // Fence-aware, on the same grounds the comment skill's counter already is:
    // the worked examples pass whole document bodies through heredocs, and the
    // `## Changelog` line inside one is that document's content, not a section
    // of this skill. Counting it would make showing the format impossible.
    let inFence = false;
    for (const line of body.split("\n")) {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      if (!inFence && line.startsWith("## ")) {
        current = line.slice(3);
        sections.set(current, []);
      } else if (current !== null) {
        sections.get(current)?.push(line);
      }
    }
    expect(sections.size).toBe(18);
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
      "corpus queue defer",
      "--blocked-on",
      "corpus queue reap-stale",
      "corpus queue halt",
      "corpus queue resume",
      'corpus job log <eventId> "<line>"',
      "corpus job retry",
      "corpus doc archive",
      "export CORPUS_FROM=agent",
      "--from agent",
      "--reason",
      ".corpus/HALT",
      // AGENT-049: the loop runs `corpus queue idle` bare, and bare prints the
      // human strings — the JSON shape exists only under `--json`, which no
      // example passes. Measured against the shipping CLI, 2026-08-23.
      "idle — no events (timeout)",
      "idle — no events (halted)",
      // SHARED-067 deleted the `<plugin>.<action>` row that used to sit here.
      // Its catch-all did not go with it: the loop still meets types it has no
      // row for, and the command it fails them with is the pinned text now.
      'corpus queue fail <id> --reason "unknown event type: <type>"',
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

  it("defers on an open editing session with the defer verb; the deferred:-prefix protocol is gone", () => {
    // AGENT-007 / SPEC §7 as signed 2026-07-30: a deferral is the defer
    // transition, never a `deferred:`-prefixed failure. The prefix survives
    // nowhere — not as an instruction, an example, or an explanation.
    expect(body).not.toMatch(/deferred:/);
    expect(body).not.toMatch(/retry the job from the console/i);
    // Reply first (a person watches a pending indicator), then defer, with
    // `--blocked-on` naming the document being edited.
    expect(body).toMatch(
      /# nothing changed, so that reply carries no trace line\ncorpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3/,
    );
    expect(body).toMatch(/names the \*\*document being edited\*\*/);
    expect(body).toMatch(/parks forever/);
    // A deferral is not a failure, and the status carries the meaning.
    expect(body).toMatch(/under\s+`deferred`, never\s+`failed`/);
    // Automatic re-entry: AGENT-022 leaves one trigger where three used to be
    // (a session ends; there is nothing to break and nothing to reap), plus the
    // parked idle unparking and `corpus job retry` as the by-hand override.
    expect(body).toMatch(/editing session on the blocked-on document \*\*ends\*\*/);
    expect(body).toMatch(/returns the event to `pending` by itself/);
    expect(body).toMatch(/parked `corpus queue idle` unparks/);
    expect(body).toMatch(/`corpus job retry` remains only as the\s+by-hand override/);
  });

  it("delegates every event, parks on dispatch, and bounds concurrency at ten", () => {
    // AGENT-005 / SPEC §7 signed 2026-07-30: delegation is unconditional and
    // the orchestrator returns to parking as soon as the batch is dispatched.
    expect(body).toMatch(/\*\*Every claimed event is worked by a subagent\.\*\*/);
    expect(body).toMatch(/You never work a job inline/);
    expect(body).toMatch(/claim → dispatch → park/);
    expect(body).toMatch(/as soon as the\s+batch is dispatched/i);
    // The bound is the product's 10 — and explicitly not the operator's number.
    expect(body).toMatch(/at most \*\*10\*\*\s+concurrent subagents/);
    expect(body).not.toMatch(/\*\*3\*\*/);
    expect(body).toMatch(/unrelated to any\s+concurrency limit the operator's own tooling/);
    // Overlap is generalized past same-document, serialized in dispatch order,
    // and spans batches.
    expect(body).toMatch(/touched sets otherwise conflict/);
    expect(body).toMatch(/serially, in dispatch order/);
    expect(body).toMatch(/spans batches/);
  });

  it("spawns subagents concretely and records outcomes only from their reports", () => {
    // The mechanism is named, the context handed over is enumerated, and the
    // wake-back story depends on nothing unshipped (Open Conflict 1 default:
    // reports are reconciled at each idle return; no `agent.done` producer).
    expect(body).toMatch(/Task \(Agent\) tool/);
    expect(body).toMatch(/launched \*\*in\s+the background\*\*/);
    expect(body).toMatch(/A subagent inherits nothing/);
    expect(body).toMatch(/Settlement never depends on any queue event/);
    // Invariants cross the boundary, including attribution and the job-log sink.
    expect(body).toMatch(/a subagent inherits no environment/);
    expect(body).toMatch(/same event id you dispatched/);
    // Queue state stays on this side; outcomes come from reports.
    expect(body).toMatch(/\*\*reports\*\* an outcome, and you \*\*record\*\* it/);
    expect(body).toMatch(/from its subagent's report, never at dispatch time/);
    expect(body).toMatch(/with \*\*the subagent's reason\*\*/);
    expect(body).toMatch(/stays `in-progress`/);
    // A subagent that stood aside defers through the orchestrator, never fails
    // — and a stale key is explicitly *not* that case (AGENT-022): the subagent
    // re-reads and writes again itself rather than reporting a block.
    expect(body).toMatch(/\*\*A subagent that stands aside defers — through you\.\*\*/);
    expect(body).toMatch(/A\s+stale-key refusal is a different thing and never reaches you/);
  });

  /**
   * AGENT-018, SPEC.md §7's rider signed 2026-08-06. Consequence was already in
   * this skill — as one factor of three, averaged in — so what these pin is the
   * **ordering**: the two-pass shape, the veto, and above all the *negative*
   * case. A consequence test drawn wide enough to fire on ordinary work changes
   * no dispatch at all, while still satisfying every positive assertion here.
   */
  describe("weighing a dispatch", () => {
    it("names the three tiers and keeps the tie-break, scoped", () => {
      expect(body).toMatch(/\*\*Opus 5\*\*/);
      expect(body).toMatch(/\*\*Haiku\*\*/);
      expect(body).toMatch(/\*\*Sonnet\*\*/);
      // The tie-break survives rather than being deleted as redundant — scoped
      // to what the orchestrator picks for itself, and second to the first pass.
      expect(body).toMatch(/In doubt between two\s+tiers, take the stronger/);
      expect(body).toMatch(/governs what \*\*you\*\* pick for yourself/);
      expect(body).toMatch(/runs after the first pass rather than beside it/);
      expect(body).toMatch(/never licence to move off a weight the request stated/);
      // And the averaged-in rule it replaces is gone, not merely supplemented:
      // leaving it would keep sending prescribed one-document edits to the
      // lightest tier no matter what the new paragraphs say.
      expect(body).not.toMatch(/Judge weight by three things/);
    });

    it("puts consequence before difficulty, as two passes rather than one list", () => {
      expect(body).toMatch(
        /judge that weight in two passes —\s+consequence first, difficulty second/,
      );
      expect(body).toMatch(
        /\*\*what a bad result would do that revising the document afterwards\s+would not undo\*\*/,
      );
      // Order is the deliverable, so it is asserted as order.
      const firstPass = body.indexOf("**First pass —");
      const secondPass = body.indexOf("**Second pass —");
      const table = body.indexOf("| Small and mechanical");
      expect([firstPass, secondPass, table]).not.toContain(-1);
      expect(firstPass).toBeLessThan(secondPass);
      expect(secondPass).toBeLessThan(table);
      // What is left in the second pass is difficulty alone.
      expect(body).toMatch(/Judge that second-pass weight by two things/);
    });

    it("states the two conditions that make a failure unrecoverable", () => {
      expect(body).toMatch(
        /\*\*to be used outside the corpus\*\* — published, sent, handed to someone/,
      );
      expect(body).toMatch(/not quietly corrected, it is rejected/);
      expect(body).toMatch(/\*\*Someone will decide something real on it\*\*/);
      expect(body).toMatch(/about a person, about money, about a\s+commitment/);
      expect(body).toMatch(/amending\s+the document afterwards does not unmake it/);
    });

    it("keeps the negative case load-bearing, with ordinary work named", () => {
      expect(body).toMatch(/expect it to answer no/);
      expect(body).toMatch(
        /An ordinary reply, an inbox capture\s+retitled and filed, a reflection on a user's edit/,
      );
      expect(body).toMatch(/every one of those answers \*\*no\*\*/);
      expect(body).toMatch(
        /noticed, commented on and\s+revised, which is this system working as designed/,
      );
      expect(body).toMatch(/A first pass that fired on everything would change no dispatch at all/);
      // The worked example is where the negative case is actually practised —
      // an example that never runs the pass teaches that the pass is optional.
      expect(body).toMatch(/The first pass ran and answered \*\*no\*\*/);
    });

    it("vetoes with the stronger tier however mechanical the work looks", () => {
      expect(body).toMatch(/dispatch the strongest tier however mechanical the work\s+looks/);
      expect(body).toMatch(/the second pass does not run/);
      // The concrete instance: mechanically trivial work with a costly failure.
      expect(body).toMatch(/a document that goes to the lender tomorrow, is not small work/);
      expect(body).toMatch(/the edit is\s+trivial and the failure is not/);
    });

    it("carries the exception in the Haiku row and moves the veto out of the Opus row", () => {
      const rows = body.split("\n").filter((line) => line.startsWith("| "));
      const haiku = rows.find((row) => row.includes("**Haiku**")) ?? "";
      const opus = rows.find((row) => row.includes("**Opus 5**")) ?? "";
      expect(haiku).toMatch(/prescribes the change exactly \*\*and the first pass answered no\*\*/);
      expect(haiku).toMatch(/is not in this row however exactly it was prescribed/);
      // "expensive to unwind" used to sit in this row as one difficulty symptom
      // beside cross-document restructuring. It is the first pass now, and the
      // row defers to it rather than restating it as an item.
      expect(opus).not.toMatch(/expensive to unwind/);
      expect(opus).toMatch(/everything the first pass vetoed, whatever its difficulty/);
    });

    it("composes with a stated weight instead of overriding one", () => {
      expect(body).toMatch(
        /\*\*A stated weight is a directive; the two passes govern only what you pick when the request\s+stated nothing\.\*\*/,
      );
      expect(body).toMatch(/never\s+quietly substitute another \*\*in either direction\*\*/);
      expect(body).toMatch(
        /running stronger than asked spends\s+against an explicit instruction exactly as running weaker falls short of one/,
      );
      // The collision case is an ask, never a silent upgrade.
      expect(body).toMatch(/\*\*ask first,\s+with a form\*\*/);
      expect(body).toMatch(/\*\*Asking is\s+not substituting\.\*\*/);
      expect(body).toMatch(/runs it at the stated weight, with no substitution anywhere/);
    });

    it("splits by what a stage outputs, never by a threshold", () => {
      expect(body).toMatch(
        /\*\*One request may be worked in stages, and the stages need not run at the same weight\.\*\*/,
      );
      expect(body).toMatch(/A stage whose output is \*\*material\*\* may run lighter/);
      expect(body).toMatch(/A stage that \*\*decides\*\* may not/);
      expect(body).toMatch(/they run at the \*\*governing weight\*\*/);
      // Why the line is drawn at the output rather than at "split when useful":
      // the loophole has a shape, and it is named.
      expect(body).toMatch(/anything\s+can be described as preparation/);
      expect(body).toMatch(/just summarising what the\s+collector found/);
      // Permission, never obligation — and never a back door in either direction.
      expect(body).toMatch(/\*\*Splitting is always permitted and never required\.\*\*/);
      expect(body).toMatch(/There is no threshold above which you\s+split/);
      expect(body).toMatch(/one piece of\s+work with one status and one reply\*\*/);
      expect(body).toMatch(
        /the deciding stage runs neither lighter nor stronger\s+than the request asked for/,
      );
    });

    it("hands a stage the previous stage's product, for quality and not only for cost", () => {
      expect(body).toMatch(
        /\*\*The anchors rule above holds between the stages of one piece of work too\.\*\*/,
      );
      expect(body).toMatch(/receives what the previous stage \*\*produced\*\*/);
      expect(body).toMatch(/not the\s+transcript, not the false starts/);
      expect(body).toMatch(/Brief every stage as though it were the first/);
      // The quality argument, stated as the reason: written as pure frugality it
      // reads as a cost tradeoff to waive whenever quality is on the line —
      // which is exactly the high-consequence case the rule exists for.
      expect(body).toMatch(/\*\*quality\*\* rule\s+before it is a saving/);
      expect(body).toMatch(/hold or improve the answer while costing less/);
      // And the honest bound: briefed further, never starved.
      expect(body).toMatch(/Where the two pull apart, quality\s+decides/);
      expect(body).toMatch(/briefed further rather than left short/);
    });

    it("logs one dispatch line per stage, each naming its tier and provenance", () => {
      expect(body).toMatch(/\*\*where that\s+tier came from\*\*/);
      expect(body).toContain("judged, difficulty");
      expect(body).toContain("judged, consequence");
      expect(body).toContain("stated by the request");
      expect(body).toMatch(/\*\*its\s+own dispatch line, in the order the stages ran\*\*/);
      expect(body).toMatch(/still\s+one job, one status and one reply/);
      // Difficulty and consequence stay distinguishable in the console: heavy
      // in-corpus work nobody is waiting on went out strong for a different
      // reason than a one-line edit that is about to leave the corpus.
      expect(body).toMatch(/a large in-corpus restructure nobody is waiting on/);
      expect(body).toMatch(/would leave those two indistinguishable/);
    });

    it("subsumes the reflection's ad-hoc tier rule into the general test", () => {
      // It read "at the **Sonnet** tier by default and **Opus 5** when step 4 is
      // going to write another document" — a second, competing rule beside the
      // one in Delegation. It is an instance of the two passes now.
      expect(body).toMatch(
        /weighed by the two\s+passes in Delegation like any other work and by no rule of its own/,
      );
      expect(body).toMatch(/reflecting answers the\s+first pass \*\*no\*\*/);
      expect(body).not.toMatch(/at the \*\*Sonnet\*\* tier\s+by default/);
    });
  });

  /**
   * AGENT-015, SPEC.md §7 and §10 (rider SHARED-022, signed 2026-08-06). The
   * tier table stopped being prose only a model reads: a composer enumerates it
   * to build its picker, so its shape is a de-facto interface. What is pinned
   * here is therefore the *parse* — the exact set, in order — because that is
   * the assertion that fails when someone rewords a header cell, and because a
   * picker built on a table it cannot read offers levels the router does not
   * implement (§2.4 makes that a real state the day a workspace edits its own
   * guidance, not a hypothetical).
   */
  describe("the declared level set", () => {
    /** A table in the declared shape, for the cases the real body cannot show. */
    const table = (rows: readonly (readonly string[])[]): string =>
      [
        `| ${WEIGHT_TABLE_HEADER.join(" | ")} |`,
        "| --- | --- | --- | --- |",
        ...rows.map((cells) => `| ${cells.join(" | ")} |`),
      ].join("\n");

    it("enumerates exactly the three shipped levels, lightest first", () => {
      // Order is part of the contract: it is the order a composer offers.
      expect(readWeightLevels(body)).toEqual([
        { name: "Small and mechanical", key: "light", model: "Haiku" },
        { name: "Standard", key: "standard", model: "Sonnet" },
        { name: "Heavy or judgment-laden", key: "heavy", model: "Opus 5" },
      ]);
    });

    it("tells the agent that the table is read by a composer, and how", () => {
      expect(body).toMatch(
        /\*\*That table is the set a request may choose from, so it is read by more than you\.\*\*/,
      );
      expect(body).toMatch(/in the order they are written — lightest first/);
      for (const cell of WEIGHT_TABLE_HEADER) expect(body, `header cell ${cell}`).toContain(cell);
      expect(body).toMatch(/in that order and spelled that\s+way, whatever the column padding/);
      // Each column's job, since three of the four have a reader outside this file.
      expect(body).toMatch(/\*\*Key\*\* is the short token that travels with the request/);
      expect(body).toMatch(/rewording a \*\*Weight\*\* leaves it untouched/);
      expect(body).toMatch(/Neither reaches a composer/);
    });

    it("states the degradation as no control, never a fallback list", () => {
      expect(body).toMatch(/Nothing outside this table declares a level/);
      expect(body).toMatch(/finds \*\*no levels\*\*/);
      expect(body).toMatch(/offers no control at all rather than a list of its own/);
      expect(body).toMatch(/correct\s+outcome rather than a fault/);
    });

    it("finds nothing when a header cell is not spelled exactly", () => {
      // The padding is prettier's and moves; the words are the interface.
      expect(readWeightLevels(body.replace(/^\| Weight\b/m, "| weight"))).toEqual([]);
      expect(
        readWeightLevels(body.replace(/^\| Weight(\s+)\| Key\b/m, "| Weight$1| Tier")),
      ).toEqual([]);
      // And it does not half-match some other table in the same document.
      expect(readWeightLevels("| Event type | Dispatch |\n| --- | --- |\n| a | b |\n")).toEqual([]);
    });

    /**
     * A fenced example documents the format; it does not declare it (UI-082's PR #35 review).
     * The reader takes the first header **outside a fence**, so a skill that
     * shows the shape before showing its own table — which is what this repo's
     * own sources do when they explain it — still declares its own table.
     */
    it.each([
      ["a plain fence", "```", ""],
      ["an info string", "```", "text"],
      ["a tilde fence", "~~~", ""],
      ["a longer fence", "````", ""],
    ])("skips an example fenced by %s and reads the real table below", (_case, marker, info) => {
      const example = table([["Example", "example", "**A model**", "Not a declaration."]]);
      const declared = table([
        ["Small", "light", "**Haiku**", "one read"],
        ["Everyday", "standard", "**Sonnet**", "most work"],
      ]);
      const markdown = `Like this:\n\n${marker}${info}\n${example}\n${marker}\n\n${declared}\n`;
      expect(readWeightLevels(markdown).map((level) => level.key)).toEqual(["light", "standard"]);
    });

    it("declares nothing when a fence is opened and never closed", () => {
      const example = table([["Example", "example", "**A model**", "Not a declaration."]]);
      expect(readWeightLevels(`Like this:\n\n\`\`\`\n${example}\n`)).toEqual([]);
    });

    it("reads a table a fence sits below", () => {
      const declared = table([["Small", "light", "**Haiku**", "one read"]]);
      expect(readWeightLevels(`${declared}\n\n\`\`\`\n| a |\n\`\`\`\n`)).toHaveLength(1);
    });

    it("finds nothing for a malformed declaration rather than part of one", () => {
      const header = `| ${WEIGHT_TABLE_HEADER.join(" | ")} |`;
      expect(readWeightLevels(`${header}\n| Small | light | **Haiku** | one read |`)).toEqual([]);
      expect(readWeightLevels(table([["Small", "light", "**Haiku**"]]))).toEqual([]);
      expect(readWeightLevels(table([["Small", "", "**Haiku**", "one read"]]))).toEqual([]);
      expect(readWeightLevels(table([["", "light", "**Haiku**", "one read"]]))).toEqual([]);
      expect(readWeightLevels(table([]))).toEqual([]);
      expect(readWeightLevels("A workspace whose guidance predates all of this.\n")).toEqual([]);
    });

    it("follows a rename and a fourth level with no change to the reader", () => {
      // The acceptance property, and the reason there is one list rather than
      // two: editing the guidance moves the picker, with nothing recompiled.
      const renamed = body.replace(/^\| Standard(\s+)\|/m, "| Everyday$1|");
      expect(readWeightLevels(renamed).map((level) => level.name)).toEqual([
        "Small and mechanical",
        "Everyday",
        "Heavy or judgment-laden",
      ]);
      // A key outlives the wording it sits beside, which is what makes a choice
      // stored yesterday still resolve after a rename.
      expect(readWeightLevels(renamed).map((level) => level.key)).toEqual(
        readWeightLevels(body).map((level) => level.key),
      );
      const four = table([
        ["Everyday", "standard", "**Sonnet**", "most work"],
        ["Deep", "deep", "**Opus 5**", "the rest"],
        ["Deeper", "deeper", "**Opus 5**", "and more"],
        ["Deepest", "deepest", "**Opus 5**", "and more still"],
      ]);
      expect(readWeightLevels(four).map((level) => level.key)).toEqual([
        "standard",
        "deep",
        "deeper",
        "deepest",
      ]);
    });

    it("declares the set in exactly one file of the shipped template", () => {
      const declaring = templateFiles.filter(
        (relPath) => readWeightLevels(readTemplateFile(relPath)).length > 0,
      );
      expect(declaring).toEqual(["claude/skills/orchestrate/SKILL.md"]);
    });

    it("keeps a second level list out of the shipped tree", () => {
      // Grep-shaped, and deliberately "two or more of the set in one file": a
      // single mention is prose (the contract cites the longest shipped level
      // name to justify a length bound), while a set of them is the enum this
      // design exists to prevent. Tests are excluded — an opaque sample value in
      // a CONTRACT-039 or SERVER-069 test is a string, not a vocabulary.
      //
      // Three things this looks for, each closing a hole the previous shape
      // left (UI-082's PR #35 review):
      //
      //   - **Labels and keys.** The label is what the guard used to match, and
      //     the key is what actually travels on a request, so a hardcoded
      //     `["light", "standard", "heavy"]` was the one form of the enum that
      //     passed. Keys are matched only as `"…"`/`'…'` **string literals**,
      //     because they are ordinary English words and a prose "light" is not a
      //     vocabulary. Backticks are deliberately not a delimiter here: a
      //     markdown code span is how every docblock in this repo names a key,
      //     and `weight.ts` legitimately names all three while justifying a
      //     length bound.
      //   - **The server too.** AGENT-015's criterion is about the product, not
      //     about the two workspaces the guard happened to name;
      //     `apps/server/src` routes the weight.
      //   - **No exemption for a published directory.** `@corpus/kit/testing`
      //     is a published subpath, so what sits in it ships whatever its name
      //     says; the assertion below pins that it is scanned.
      //     Only `apps/ui/src/testing` is exempt, and only because a fixture
      //     *must* spell a whole declaration — UI-082's suites drive five
      //     composers from a fixture skill document, and a fixture that could
      //     not name a set could not prove the picker follows the document. That
      //     tree is private to `@corpus/ui`, which publishes nothing.
      const levels = readWeightLevels(body);
      const labels = levels.map((level) => level.name);
      const keys = levels.map((level) => level.key);
      const quoted = keys.map(
        (key) => new RegExp(`(["'])${key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\\1`),
      );

      const EXEMPT = [path.join(REPO_ROOT, "apps", "ui", "src", "testing")];
      const sources = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "dist") return [];
            return EXEMPT.includes(full) ? [] : sources(full);
          }
          if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
          return [full];
        });
      const scanned = [
        "apps/ui/src",
        "apps/server/src",
        "packages/kit/src",
        "packages/contract/src",
      ].flatMap((root) => sources(path.join(REPO_ROOT, root)));

      // The key matcher, proven on the exact form it exists to catch, so a
      // regex that silently stopped matching would not read as a clean guard.
      const enumSource = `const WEIGHTS = [${keys.map((key) => `"${key}"`).join(", ")}] as const;`;
      expect(quoted.filter((pattern) => pattern.test(enumSource))).toHaveLength(keys.length);
      expect(quoted.some((pattern) => pattern.test("a light touch, the standard way"))).toBe(false);

      expect(scanned.length, "nothing scanned — the guard would pass vacuously").toBeGreaterThan(0);
      expect(scanned, "`@corpus/kit/testing` is published — it may not be exempt").toContain(
        path.join(REPO_ROOT, "packages", "kit", "src", "testing", "index.ts"),
      );

      for (const file of scanned) {
        const contents = readFileSync(file, "utf8");
        const hits = [
          ...labels.filter((label) => contents.includes(label)),
          ...quoted.filter((pattern) => pattern.test(contents)).map((pattern) => pattern.source),
        ];
        expect(
          hits.length,
          `${path.relative(REPO_ROOT, file)} carries a second level list: ${hits.join(", ")}`,
        ).toBeLessThan(2);
      }
    });
  });

  /**
   * AGENT-015's other half: what happens to a weight the request already chose.
   * Each rule here has a failure mode that reads as care — upgrading "to be
   * safe", quietly downgrading a level the workspace dropped, or disagreeing by
   * dispatching something else and saying nothing — so each is pinned with the
   * words that make the failure recognisable.
   */
  describe("a weight the request stated", () => {
    it("honours it rather than weighing it again, from the payload's field", () => {
      expect(body).toMatch(/`weight` field of the claimed event's\s+payload/);
      expect(body).toMatch(/carrying one of the \*\*Key\*\* tokens above/);
      expect(body).toMatch(/\*\*honoured, not weighed again\*\*/);
      expect(body).toMatch(/dispatch at that weight rather than at the one you would have picked/);
    });

    it("forbids substitution in both directions, in both words", () => {
      expect(body).toMatch(/never quietly weaker, never quietly\s+stronger/);
      expect(body).toMatch(/\*\*in either direction\*\*/);
    });

    it("makes the choice travel with the work, not with the turn", () => {
      expect(body).toMatch(
        /\*\*The choice travels with the work, not with the turn that received it\.\*\*/,
      );
      expect(body).toMatch(/onward through every further delegation that work requires/);
      expect(body).toMatch(/whose deciding stage runs at it/);
      // Two directives compose rather than one cancelling the other.
      expect(body).toMatch(/both are directives and they compose/);
    });

    it("keeps the unset case as the orchestrator's judgment, never a default", () => {
      expect(body).toMatch(
        /\*\*Stating no weight means you decide, exactly as you decide today\.\*\*/,
      );
      expect(body).toMatch(/never a fixed default/);
      expect(body).toMatch(/there is no level you fall back\s+to/);
      expect(body).toMatch(/the only spelling of it/);
    });

    it("does the work anyway when a stated weight cannot be met, and says so twice", () => {
      expect(body).toMatch(
        /\*\*When a stated weight cannot be honoured, the work is still done and the deviation is stated\s+twice\.\*\*/,
      );
      // All three causes, so a missing model and a level the table dropped are
      // handled by one rule rather than improvised separately.
      expect(body).toMatch(/the installed agent offers no such model, the setup refuses/);
      expect(body).toMatch(/the key names a level this table no longer declares/);
      expect(body).toMatch(/None of the three is a reason to\s+drop the work or to fail the event/);
      // Twice, and the three facts each statement carries.
      expect(body).toMatch(
        /\*\*in the job's log while it runs\*\* and \*\*in the reply the request receives\*\*/,
      );
      expect(body).toMatch(/what was asked for, that it could not be met, and what ran\s+instead/);
      // Why the reply is not optional: the log does not survive the event.
      expect(body).toMatch(/The log is reaped with its event, so the reply is the durable half/);
      expect(body).toMatch(/claiming work it did not do/);
    });

    it("expresses disagreement as speech, never as substitution", () => {
      expect(body).toMatch(/\*\*Your own judgment survives as speech, never as substitution\.\*\*/);
      expect(body).toMatch(/do it at the stated weight and say so in the reply/);
      expect(body).toMatch(/ask before dispatching rather than explain afterwards/);
      // The reason the silent version is worse than the disagreement.
      expect(body).toMatch(
        /nothing in the console and nothing on the turn would show that it happened/,
      );
    });

    it("logs a fourth dispatch shape when a stated weight went unmet", () => {
      expect(body).toMatch(/Four shapes, one grammar/);
      expect(body).toContain(
        "(Sonnet — stated by the request as heavy, not honoured: this workspace declares no such level, so the tier is judged, difficulty)",
      );
      expect(body).toMatch(/names the ask, that it went unmet, and what ran instead/);
      // The line is checkable rather than self-reported: the server wrote the
      // ask onto the same log before any dispatch line existed.
      expect(body).toContain("`weight stated by the request: <key>`");
      expect(body).toMatch(/a claim of honouring is verifiable/);
    });
  });

  /**
   * Reflect-on-edit (AGENT-011, SPEC.md §4's edit-acknowledgment rider signed
   * 2026-08-02). The rider's four load-bearing claims — the diff is fetched with
   * the event's range, triviality is decided from the change rather than its
   * size, the acknowledgment lands on the document's own surface, and nothing
   * about reflecting can cascade — are asserted here so a later rewrite cannot
   * quietly turn the feature into comment spam or into silence.
   */
  describe("doc.edited", () => {
    it("routes the event and names the procedure that handles it", () => {
      expect(body).toContain("`doc.edited`");
      expect(body).toMatch(/\*\*Reflecting on a user edit\*\* below/);
      // It touches the payload's document, so it orders against thread work.
      expect(body).toMatch(/`doc\.edited`: the payload's `docId`/);
    });

    /**
     * AGENT-028. SERVER-113 moved **both** ends of a range onto *this
     * document's* history, and the consequence nobody predicted at the time is
     * that every document's first change now diffs against git's empty tree —
     * where this text still called it the base "carried by a document the
     * repository's first commit introduced".
     *
     * That is product text rather than repository documentation: it is what a
     * user's agent reads to decide what a diff means, and an agent told the
     * empty tree is a rarity may report an ordinary new document as an anomaly.
     *
     * The same sentence has now been found stale in four surfaces (SPEC.md
     * §9.2, the published contract, the CLI help, these skills), each time by
     * somebody doing something else — so it is pinned in both directions: the
     * correct framing must be present *with its reason*, and the too-narrow one
     * must be absent from every installed skill. The
     * reason is the half that stops it drifting back: §4's commit windows are
     * party-scoped, so the parent of a window commit is not this document's
     * history but whoever else's document was saved in the same window.
     */
    it("teaches the empty-tree base as the ordinary shape of a first change", () => {
      const flat = body.replace(/\s+/g, " ");
      // Matched to `packages/contract/src/schemas/edit.ts` rather than phrased
      // a fifth time: any document's first change, not the repository's.
      expect(flat).toMatch(/empty-tree sha an event carries for a document's \*\*first\*\* change/);
      expect(flat).toMatch(/ordinary shape of a first change, not an anomaly to report/i);
      expect(flat).toMatch(/\*\*any\*\* document's first commit/);
      // The why, without which the narrow framing grows back.
      expect(flat).toMatch(/belongs to a party rather than to a document/i);
      expect(flat).toMatch(/somebody else's save to a different file/i);
      expect(flat).toMatch(/this document did not exist/i);
    });

    /**
     * The negative half, across every installed skill. A sentence may still
     * mention the repository's own first commit — the corrected wording does,
     * to say the base is *not only* that — so what is forbidden is the
     * unqualified equation, which is exactly what the stale text was.
     */
    it.each(installedSkills)(
      "$label never ties the empty tree to the repository's own first commit",
      ({ label, body: skillBody }) => {
        const sentences = skillBody
          .replace(/\s+/g, " ")
          .split(/(?<=\.)\s+/)
          .filter((sentence) => /empty[- ]tree/i.test(sentence));
        for (const sentence of sentences) {
          if (!/repositor|root commit/i.test(sentence)) continue;
          expect(sentence, `${label}: narrows the empty tree to the repository`).toMatch(
            /not only|never only|not just|rather than only|whether or not/i,
          );
        }
      },
    );

    it("fetches the diff with the event's range, passed through unchanged", () => {
      expect(body).toMatch(
        /corpus doc diff doc_a1b2c3 --from-rev [0-9a-f]{40} --to-rev [0-9a-f]{40}/,
      );
      expect(body).toMatch(/`--from-rev` and `--to-rev` unchanged/);
      expect(body).toMatch(/empty-tree sha/);
      // The stats size the read; they never stand in for it.
      expect(body).toMatch(/The stats do not decide whether to make that call/);
      expect(body).toMatch(/`will` becomes `will not` at `\+1 -1`/);
    });

    it("decides triviality from the claims a diff changes, not from its size", () => {
      expect(body).toMatch(/\*\*trivial\*\* when every changed line says what it said before/);
      expect(body).toMatch(/\*\*substantive\*\* when any changed line adds, removes or reverses/);
      expect(body).toMatch(/Length is never the test/);
      // Under-reacting is the tie-break, and a trivial edit writes nothing.
      expect(body).toMatch(
        /\*\*A trivial edit is completed in silence\*\* — no thread, no reply, no write/,
      );
      expect(body).toContain(
        'corpus job log evt_7c1d9a "doc.edited on [[doc_a1b2c3]] — rewrapped a paragraph, no claim changed"',
      );
    });

    it("checks the ripple by retrieving, within a stated bound", () => {
      expect(body).toMatch(/corpus doc related doc_a1b2c3 --limit 5/);
      expect(body).toMatch(/at most three claims/);
      expect(body).toContain("--references doc_a1b2c3");
      expect(body).toMatch(/open at most three/);
      // Logging is the default now (AGENT-020); updating stays the
      // entailed-correction case, and asking is the only one that is a thread.
      expect(body).toMatch(/lean to logging/i);
      expect(body).toMatch(/mechanical and entailed/);
      expect(body).toMatch(/Stop at three documents/);
    });

    it("restates the actor guarantee so the reflection cannot cascade or self-suppress", () => {
      expect(body).toMatch(/\*\*Your own edits never wake you\.\*\*/);
      expect(body).toMatch(/The payload's actor is always `user`/);
      expect(body).toMatch(/nothing here feeds itself/);
      // The dedupe key is named, and dropping a repeat is a completion.
      expect(body).toMatch(/at most one event exists per `sessionId`/);
    });

    /**
     * PR #22 review, MINOR 6. The first version of this section told the model an
     * agent turn "enqueues nothing unless it carries an explicit request", and
     * then to "edit and comment freely… there is no reason to suppress a change
     * out of caution about a loop that cannot happen". The loop *can* happen:
     * `shouldEnqueue` tests the turn's **body** before it tests the author, so a
     * turn mentioning `@agent` enqueues whoever wrote it.
     *
     * The path is not hypothetical — a ripple comment or an acknowledgment that
     * quotes a user's line carries whatever that line said. So the guarantee is
     * pinned as two obligations rather than one, and the quoting hazard by name,
     * because that is the one a careful model would otherwise walk into.
     */
    it("names both obligations, and the quoting hazard that reaches past them", () => {
      expect(body).toMatch(/no `--requests-agent`\s*\n?\s*and no `@agent` in the body/);
      expect(body).toMatch(/checks the turn's \*body\* before it checks the author/);
      expect(body).toMatch(/quotes a user's line/);
      // And it must not tell the model the loop is impossible.
      expect(body).not.toMatch(/a loop that cannot happen/);
    });

    it("refuses to reason about a cut diff as a whole one", () => {
      expect(body).toMatch(/\*\*A cut diff is never reasoned about as if it were whole\.\*\*/);
      expect(body).toContain("showing 16000 of 61200 characters");
      expect(body).toMatch(/never update another document off it/);
      expect(body).toMatch(
        /corpus doc diff doc_a1b2c3` with no range reads its newest commit whole/,
      );
      expect(body).toMatch(/corpus doc show doc_a1b2c3` gives the document\s+as it now stands/);
    });

    it("works the whole procedure once, ending in a settled event", () => {
      expect(body).toMatch(/\*\*Worked, end to end\.\*\*/);
      expect(body).toMatch(/corpus job log evt_7c1d9a "claimed doc\.edited on \[\[doc_a1b2c3\]\]/);
      expect(body).toMatch(/^\+The working rate assumption is 6\.4%/m);
      expect(body).toMatch(
        /corpus doc edit doc_7e3a91 --key [0-9a-f]{64} --from agent <<'CORPUS_EOF'/,
      );
      // It ends in an entry, not in a thread: the read that makes an append
      // possible, the write that carries it, and a job log saying so. The
      // append is the keyed whole-body write, and the key it presents must be
      // the one that read printed — a worked example that presented any other
      // key would teach the one mistake AGENT-022 exists to prevent.
      const append =
        /corpus doc show doc_a1b2c3\nkey ([0-9a-f]{64})\ncorpus doc edit doc_a1b2c3 --key ([0-9a-f]{64}) --from agent <<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF/.exec(
          body,
        );
      expect(append, "no worked append in the reflection example").not.toBeNull();
      expect(append?.[2], "the append presents a key its read never printed").toBe(append?.[1]);
      // And the entry it appends goes under the one already there, with that
      // earlier entry passed back through rather than rewritten.
      const sent = append?.[3] ?? "";
      expect(sent).toContain("## Changelog");
      expect(sent.indexOf("**2026-07-14**")).toBeLessThan(sent.indexOf("**2026-07-28**"));
      expect(body).toContain(
        'corpus job log evt_7c1d9a "completed — logged the change on [[doc_a1b2c3]], no thread opened"',
      );
    });

    /**
     * AGENT-020, SPEC §5/§7/§10's rider signed 2026-08-07. Noticing writes an
     * entry; only needing something opens a thread. Each load-bearing claim is
     * pinned separately, because the ones that decay quietly are the mechanical
     * ones — the exact heading, the read-before-write that makes an append an
     * append, and the refusal to prune — and a decayed one is invisible until a
     * person's own writing has already been overwritten.
     */
    describe("the changelog", () => {
      it("writes the observation into the document and opens no thread", () => {
        expect(body).toMatch(/\*\*5 — Write the entry, and open no thread\.\*\*/);
        expect(body).toMatch(/\*\*Noticing is written\s+down, not asked about\.\*\*/);
        expect(body).toMatch(/A thread means _I need something from you_/);
        expect(body).toMatch(/a changelog entry means\s+_I noticed_/);
        expect(body).toMatch(/One entry per session, never a second/);
        expect(body).toMatch(/A trivial edit gets none of this/);
        // The reflection's own acknowledgment thread is gone, in every form.
        expect(body).not.toMatch(/corpus thread create --parent doc_a1b2c3/);
      });

      it("leaves no escape hatch for an observation that merely looks serious", () => {
        // The rejected middle option: "but open a thread if it seems
        // consequential". A worrying observation is an entry like any other.
        expect(body).toMatch(
          /the routine ones and the\s+ones that look worrying, on the same terms/,
        );
        expect(body).toMatch(/still an entry and nothing more/);
        // A thread needs a question the agent cannot proceed without, asked
        // with a form — the one door, named where the door is.
        expect(body).toMatch(/a question you cannot\s+proceed without/);
        expect(body).toMatch(/on one thread, with a form/);
        // And the accepted cost is written down rather than quietly dropped.
        expect(body).toMatch(/an observation nobody reads\s+is an observation nobody sees/);
      });

      it("pins one spelling for the heading and says what a second one costs", () => {
        expect(body).toContain("`## Changelog`");
        expect(body).toMatch(/spelled `## Changelog` and nothing else/);
        expect(body).toMatch(/a second spelling\s+is a second section/);
        // Both worked heredocs write that exact heading, so the format the
        // skill describes is the format its example produces.
        const changelogFences = fencedBlocks(body).filter((block) =>
          block.content.includes("## Changelog"),
        );
        expect(changelogFences.length).toBeGreaterThanOrEqual(2);
        for (const fence of changelogFences) {
          expect(fence.content).toMatch(/^## Changelog$/m);
          expect(fence.content).toMatch(/^- \*\*\d{4}-\d{2}-\d{2}\*\* — /m);
        }
      });

      it("appends by reading first, and forbids rewriting the section", () => {
        expect(body).toMatch(/\*\*Append; never rewrite the section\.\*\*/);
        expect(body).toMatch(/There is no append verb/);
        // The read is what makes the write an append rather than a replacement.
        expect(body).toMatch(/corpus doc show doc_a1b2c3` for the body as it now stands/);
        expect(body).toMatch(/every other byte reproduced\s+exactly/);
        // Sending the body back is not licence to improve the person's wording
        // on the way through — the failure the rewrite ban exists for.
        expect(body).toMatch(/not a licence to tidy it on the way\s+through/);
        // The same read hands over the key the append presents (AGENT-022).
        expect(body).toMatch(/corpus doc edit doc_a1b2c3 --key <the key that read printed>/);
        // The reason, not only the rule: the person writes in here too, and a
        // rewrite orphans every thread anchored into what it replaced —
        // measured against a running server, which reports it only afterwards.
        expect(body).toMatch(/The person writes in this section too/);
        expect(body).toMatch(/how their\s+writing disappears/);
        expect(body).toMatch(/comes loose, which\s+the edit reports as an orphan after the fact/);
        expect(body).toMatch(/Entries run oldest first/);
      });

      it("states the shared ownership the format depends on", () => {
        expect(body).toMatch(
          /\*\*The changelog is yours to maintain and theirs to edit; neither of\s+you owns it\.\*\*/,
        );
        // Ordinary body content: remarking on an entry needs no new machinery.
        expect(body).toMatch(/commentable, anchorable, searchable/);
        expect(body).toMatch(/an ordinary anchored comment and needs\s+nothing special/);
      });

      it("makes the entry a judgement rather than a restatement of the diff", () => {
        expect(body).toMatch(/\*\*Say what you made of it, not what the diff said\.\*\*/);
        expect(body).toMatch(/Git holds every diff already/);
        expect(body).toMatch(/worth less than the room it takes/);
        expect(body).toMatch(/what you deliberately left alone/);
        // An entry is body text, so the turn-only trace arrow has no place in it.
        expect(body).toMatch(/carries no trace arrow/);
      });

      it("checks the append against the anchor report, and never prunes", () => {
        // Measured on a running server: a faithful append never orphans, but the
        // *first* entry does report one remapped anchor — the one whose trailing
        // context the new section rewrote. Telling the agent to expect a clean
        // report would have it re-doing a correct append forever, so `orphaned`
        // is named as the signal and `remapped` is disarmed by name.
        expect(body).toMatch(/\*\*The word to read in the anchor report is `orphaned`\.\*\*/);
        expect(body).toMatch(/an honest append orphans nothing/);
        expect(body).toMatch(/what you sent was not what you read/);
        expect(body).toMatch(/A \*\*remap\*\* is a different thing and\s+not a warning/);
        expect(body).toMatch(/reported as remapped while staying exactly where it was/);
        expect(body).toMatch(/Later appends land past the section\s+and report nothing at all/);
        // Growth is the reader's problem, not a licence to drop history.
        expect(body).toMatch(/\*\*Length is never a reason to prune\.\*\*/);
        expect(body).toMatch(/how many entries sit behind the control/);
        expect(body).toMatch(/never fold two into one/);
      });

      it("checks the append with a key, and reaches every recovery", () => {
        // The check on an append is the key, not a quote (AGENT-024 re-review):
        // a quote covers the text it replaces, and an append's correctness
        // depends on text it does not name. Both ways the write can come back
        // have to be reachable from here or the entry is lost (AGENT-022).
        expect(body).toMatch(
          /\*\*This write replaces the body, so it presents a key — where a thread post would have\s+needed\s+none\.\*\*/,
        );
        expect(body).toMatch(/refused at exit `9` carrying the current text and a\s+fresh key/);
        expect(body).toMatch(/somebody appended their own entry/);
        expect(body).toMatch(/append your entry to \*that\* body/);
        expect(body).toMatch(/defer with `--blocked-on` naming it/);
        expect(body).toMatch(/never drop\s+the entry because the document was busy/i);
      });

      it("puts the rule in the stewardship charter, scoped to noticing alone", () => {
        expect(body).toMatch(/\*\*Noticing a change is written down, not asked about\.\*\*/);
        expect(body).toMatch(/no thread is opened for it/);
        expect(body).toMatch(/ask for that decision with a form/);
        // It narrows noticing and nothing else — every other ask is unchanged.
        expect(body).toMatch(/narrows what a noticed change may do and narrows nothing else/);
        // With no reply to state a change in, the entry is that statement.
        expect(body).toMatch(/the changelog entry is that statement/);
      });
    });
  });

  /**
   * Reconciling the server's in-progress set (AGENT-013, SPEC.md §7's rider
   * signed 2026-08-05). The feature is data the CLI already prints; this is the
   * only place that tells the agent to *act* on it, so each of the rider's
   * load-bearing claims is pinned — the shape, the two-list separation, both
   * branches, and above all the never-settle clause **with its reason**, which
   * is the one a reader who does not know why would optimise away.
   */
  describe("in-progress reconciliation", () => {
    it("documents the payload the CLI actually prints, both lists in one line", () => {
      // The claim example carries `events` and `inProgress` as siblings, with a
      // populated row: the old `{"events":[…]}` shape is not the wire shape and
      // an agent matching it exactly would miss the field entirely.
      expect(body).toMatch(
        /\{"events":\[\{"id":"evt_7c1d9a".*\}\],"inProgress":\{"events":\[\{"id":"evt_2e4f8b","type":"comment\.created","heldSince":"[^"]+","originId":"th_9d2f7a","originTitle":"[^"]+"\}\],"total":1,"truncated":false\}\}/,
      );
      // The overflow pair reaches the reader as a rule, not only as an example,
      // and the uncapped view is named.
      expect(body).toMatch(/capped at the 20 most recently claimed/);
      expect(body).toMatch(/`total` is how\s+many are really held/);
      expect(body).toMatch(/`truncated` is true when the cap bit/);
      expect(body).toContain("corpus job list --status in-progress");
      // `idle` carries it too, so the loop is not told to look in one place only.
      expect(body).toMatch(/`corpus queue idle` reports the same field/);
    });

    it("no longer names an exact empty-batch payload as the halted signal", () => {
      // `{"events":[]}` stopped being the literal shape when `inProgress` became
      // required; the signal is the empty array, not the whole payload.
      expect(body).not.toContain('{"events":[]}');
      expect(body).toMatch(/An \*\*empty `events` array\*\* is not an\s+error/);
      // And the reconciliation still happens on a claim that returned nothing.
      expect(body).toMatch(/reported on every claim, empty batch included/);
    });

    it("separates the held list from the claimed batch, as a fact about ordering", () => {
      expect(body).toMatch(
        /\*\*`inProgress` is a different list from the one you just claimed, and never work to do\s+again\.\*\*/,
      );
      // The server reads `in-progress/` before the claim's moves, which is what
      // makes "never do this work again" safe rather than a hedge.
      expect(body).toMatch(/as it stood \*before\* this call's moves/);
      expect(body).toMatch(/the events of this\s+batch are never in it/);
    });

    it("gives both branches, and forbids redoing settled work", () => {
      expect(body).toMatch(/\*\*You already did this work\*\*/);
      expect(body).toMatch(/\*\*do not do the work again\*\*/);
      expect(body).toContain("corpus queue complete evt_2e4f8b");
      expect(body).toContain(
        'corpus job log evt_2e4f8b "settled late — the reply on th_9d2f7a was already posted"',
      );
      expect(body).toMatch(/\*\*You are still working it\*\*/);
      expect(body).toMatch(/Leave it\s+exactly where it is/);
    });

    it("states the never-settle clause together with the reason for it", () => {
      expect(body).toMatch(/\*\*Never settle an event you cannot account for\.\*\*/);
      // Reconciliation is the agent's own judgement, and the server abstains.
      expect(body).toMatch(/the server reports this list and settles nothing on it\s+by itself/);
      // The reason, in full: the failure of tidying is silent and asymmetric.
      expect(body).toMatch(/kills that run's accounting silently/);
      expect(body).toMatch(/visible problem/);
      expect(body).toMatch(/invisible failure is much the worse/);
      expect(body).toMatch(/shortening the list is never a reason to settle anything/);
    });

    it("leaves dead sessions to reap-stale, and says it is a requeue", () => {
      expect(body).toMatch(/\*\*You are not the cleanup for sessions that died, either\.\*\*/);
      expect(body).toMatch(/it is a \*\*requeue\*\*/);
      expect(body).toMatch(/done again rather\s+than dropped/);
      expect(body).toMatch(/Nothing is lost by leaving an unfamiliar row alone/);
    });

    it("makes reconciliation a numbered step of the loop, not a comment in a script", () => {
      // It used to be a `#` comment inside the loop's single bash block, which
      // is precisely the form an agent reading that fence as a script drops
      // (AGENT-019). It is a step of the procedure now.
      const loop = body.slice(body.indexOf("## The loop"), body.indexOf("## Claiming"));
      expect(loop).toMatch(/^\d+\. \*\*Reconcile that held list against your own work\*\*/im);
      expect(loop).toMatch(/\(Claiming and batching below\)/);
    });
  });

  /**
   * AGENT-019, reported from a live run on 2026-08-07: events were claimed and
   * never dispatched, because the session ran `claim-all` and `idle` as one
   * chained background command and never read its output. That chain was not a
   * misreading of the loop block — every executable line in it was a
   * `corpus queue` call and the one load-bearing step between them, dispatch,
   * was a `#` comment. The literal executable reading of that fence *was* a
   * working loop that skipped dispatch.
   *
   * So both halves are pinned here: the prohibition in words, with the cost it
   * carries, and the structural property that makes the prohibition hard to
   * disobey — the section contains no script anyone can copy, and no fence in
   * the skill pairs the two commands.
   */
  describe("the loop is a procedure, not a script", () => {
    const loop = body.slice(body.indexOf("## The loop"), body.indexOf("## Claiming"));

    it("prohibits chaining claim-all with idle, and says what the chain does", () => {
      expect(loop).toMatch(/\*\*never\s+chained\*\*/i);
      expect(loop).toMatch(
        /`corpus queue claim-all` and `corpus queue idle` are always separate commands/,
      );
      expect(loop).toMatch(/with dispatch between them/);
      // The cost, not merely the rule: a chain claims and re-parks, and every
      // event it claims is worked by nobody, invisibly.
      expect(loop).toMatch(/nowhere to put dispatch/);
      expect(loop).toMatch(/worked by nobody/);
      expect(loop).toMatch(/no error anywhere/);
    });

    it("never writes the chain down, anywhere in the body", () => {
      // An example beats a rule — including an example shown as the bad case.
      expect(body).not.toMatch(/claim-all\s*(?:&&|\|\||[|;])\s*corpus queue idle/);
      expect(body).not.toMatch(/queue idle\s*(?:&&|\|\||[|;])\s*corpus queue claim-all/);
    });

    it("runs idle alone and reads its return before anything else", () => {
      expect(loop).toMatch(/\*\*Park, alone\.\*\*/);
      expect(loop).toMatch(/`corpus queue idle` is the entire command/);
      expect(loop).toMatch(/\*\*Read what `idle` returned, before anything else happens\.\*\*/);
      // Why it is read: the return is the arrival signal, so the instruction
      // cannot be demoted to bookkeeping and dropped under pressure.
      expect(loop).toMatch(/That return \*\*is\*\* the\s+arrival notification/);
      expect(loop).toMatch(/a return\s+nobody read is an event nobody works/);
      expect(loop).toMatch(/not a log/);
    });

    it("states the loop as discrete steps, with dispatch among them", () => {
      const steps = loop.split("\n").filter((line) => /^\d+\. \*\*/.test(line));
      expect(steps.length).toBeGreaterThanOrEqual(8);
      // Dispatch is a step of the procedure, and it says it is not a command.
      // The label carries the listener launches too since AGENT-026, so it is
      // matched as a prefix rather than as a closed bold span.
      expect(loop).toMatch(/\*\*Dispatch every claimed event to a subagent/);
      expect(loop).toMatch(/\*\*This\s+step is work, not a command\*\*/);
      // Claim, then dispatch, then park — in that order, as steps.
      const order = [
        "**Claim, then read what it printed.**",
        "**Dispatch every claimed event to a subagent",
        "**Park, alone.**",
      ].map((label) => loop.indexOf(label));
      expect(order).not.toContain(-1);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it("leaves no fenced block anyone can copy as the loop", () => {
      // The structural half: there is no script in this section, so there is no
      // executable reading of it that skips dispatch.
      expect(fencedBlocks(loop)).toEqual([]);
      // And nowhere else in the skill does one fence carry both commands — an
      // example pairing them would teach the bug the prose forbids.
      for (const block of fencedBlocks(body)) {
        const pairsThem =
          block.content.includes("corpus queue claim-all") &&
          block.content.includes("corpus queue idle");
        expect(pairsThem, `fence opening at line ${block.openLine} pairs claim-all with idle`).toBe(
          false,
        );
      }
    });

    it("keeps the empty-batch pass a two-command pass as well", () => {
      const claiming = body.slice(body.indexOf("## Claiming"), body.indexOf("## Routing"));
      expect(claiming).toMatch(/park\s+with a separate `corpus queue idle`/);
      expect(claiming).toMatch(/still two commands rather than one/);
    });

    it("dispatches between the claim and the park in the worked example too", () => {
      const example = body.slice(body.indexOf("## Worked example"));
      expect(example).toMatch(/\*\*Then the step that no command performs\.\*\*/);
      expect(example).toMatch(/Only once\s+it is out does the next command run/);
      expect(example).toMatch(/`corpus queue idle`, alone,\s+never appended to the claim above/);
      // And the settling fence no longer trails a park command an agent would
      // lift as "the next thing to run" without reading anything.
      const fences = fencedBlocks(example);
      expect(fences.length).toBeGreaterThan(0);
      for (const fence of fences) expect(fence.content).not.toContain("corpus queue idle");
    });
  });

  /**
   * AGENT-026, SPEC.md §7 as amended by SHARED-043. The orchestrator's claim
   * stopped being the whole queue: it is one lane, widened at claim time to
   * include every lane whose listener has lapsed.
   *
   * Every rule pinned here has a failure that is silent in the running product,
   * and each was measured against a real server rather than reasoned:
   *
   * - **The unscoped call is this lane's only spelling.** `--thread` is not an
   *   error for the orchestrator, it is *somebody else's conversation*, so an
   *   example that scoped one would park this loop on a resident's lane and
   *   leave its own undrained, with nothing reported anywhere.
   * - **A designation is a launch, not a job.** Completing at launch time is
   *   what keeps a weeks-long listener out of `in-progress/`; an unrouted
   *   `resident.designated` fails as an unknown type and no listener ever starts.
   * - **The claim is not audited.** Measured: an unscoped claim came back empty
   *   while a live lane held a pending event, and handed that same event over
   *   once the lane lapsed. An orchestrator that re-derives the walk hands back
   *   work nobody else can see.
   * - **A lapse is never announced in the thread.** The person can already see
   *   the lane; a turn apologising for a missing resident is an operator's
   *   diagnostic posted into their conversation.
   * - **The window is the contract's number.** Same guard the converse skill and
   *   CLI-043's help carry: a restated 16m drifts from the verdict it explains.
   */
  describe("sharing the queue", () => {
    const routing = body.slice(body.indexOf("## Routing"), body.indexOf("## Delegation"));
    const claiming = body.slice(body.indexOf("## Claiming"), body.indexOf("## Routing"));

    it("owns one lane and spells it with the absent flag", () => {
      expect(body).toMatch(
        /\*\*The queue is partitioned into lanes, and you own one of them\.\*\*/,
      );
      expect(body).toMatch(
        /\*\*Your lane is the unscoped one, and the absent flag is how it is spelled\.\*\*/,
      );
      // The old claim — that this session is the only process that claims
      // anything — is gone rather than softened: left in, it authorises taking
      // a live conversation's work back off its resident.
      expect(body).not.toMatch(/the \*\*only\*\* process that\s+claims/);
      expect(body).toMatch(/you are the only one that claims \*\*your\*\* lane/);
      expect(body).toMatch(/now holds per lane/);
    });

    it("works no queue command that would reach another lane", () => {
      // The mechanical half of the rule above: `--thread` names a resident's
      // conversation, and nothing this skill runs may carry one.
      const worked = fencedBlocks(body)
        .filter((block) => block.info === "bash")
        .flatMap((block) =>
          extractCorpusInvocationUses(["```bash", block.content, "```"].join("\n")),
        )
        .filter(({ tokens }) => tokens[0] === "queue");
      expect(
        worked.length,
        "no worked queue command — the guard would pass vacuously",
      ).toBeGreaterThan(0);
      for (const use of worked) {
        expect(
          use.flags,
          `\`corpus ${use.tokens.join(" ")}\` scoped to another lane`,
        ).not.toContain("--thread");
      }
    });

    it("routes a designation to a launch that completes at launch time", () => {
      const rows = routing.split("\n").filter((line) => line.startsWith("| "));
      const designation = rows.find((row) => row.includes("`resident.designated`")) ?? "";
      expect(designation, "no routing row for resident.designated").not.toBe("");
      expect(designation).toMatch(/\*\*converse\*\*/);
      expect(designation).toContain("threadId");
      expect(designation).toContain("resident");
      // The launch, and the two things a subagent cannot inherit.
      expect(routing).toMatch(/\*\*Launching a listener\.\*\*/);
      expect(routing).toMatch(/invoked as `\/converse <the payload's threadId>`/);
      expect(routing).toMatch(/\*\*exactly as it came\*\* — every field, whatever it holds/);
      // Settled at launch, because the listener outlives the event by weeks.
      expect(routing).toMatch(/\*\*complete the event as soon as the launch is\s+made\*\*/);
      expect(routing).toMatch(/The listener's lifetime is not the job's/);
      expect(routing).toMatch(/You never wait on it, you never settle for it/);
      expect(routing).toMatch(/sign-off rather than an outcome to\s+verify/);
      // The one thing that does fail it.
      expect(routing).toMatch(/fails the event is a launch that did not happen/);
    });

    it("launches once per lane per pass, and stops when a launch does not take", () => {
      // Re-designation of a live lane, which arrives whether or not it is needed.
      // AGENT-040 qualified the rule: the decline holds only where no release has
      // passed through this session for the lane; the exception is pinned in "a
      // listener launched at its designation's weight".
      expect(routing).toMatch(
        /\*\*A lane that already has a listener gets nothing — unless this session has processed a\s+release on that same lane\.\*\*/,
      );
      expect(routing).toMatch(/re-designating is the only way a person can ask for a listener/);
      expect(routing).toMatch(/Launch nothing, log why, complete/);
      // The roster, not the batch, is what triggers a launch — and the restart
      // case, which no event announces at all.
      expect(routing).toMatch(/\*\*A lane with nobody on it gets one, once a pass\.\*\*/);
      expect(routing).toMatch(/\*\*once per pass,\s+per lane, and never per event\*\*/);
      expect(routing).toMatch(
        /where every\s+designation is still sitting on its thread and every listener is gone/,
      );
      expect(routing).toMatch(
        /a `resident.designated` for a lane\s+you have already launched into this pass launches nothing further/,
      );
      // And the bound on retrying, which is what stops a broken persona
      // becoming the loop's only activity.
      expect(routing).toMatch(/stop\s+relaunching that lane/);
      expect(routing).toMatch(/Relaunching every pass forever/);
      // AGENT-029: the bound is a bound, not a diagnosis. A listener that
      // started, claimed and is inside a long turn reads not-live exactly as a
      // dead one does, so a console line calling that a failed launch sends an
      // operator hunting a persona that is at that moment answering somebody.
      expect(routing).toMatch(/\*\*standing down, never as a failed launch\*\*/);
      // The roster is read before the claim and acted on after it.
      const loop = body.slice(body.indexOf("## The loop"), body.indexOf("## Claiming"));
      expect(loop).toMatch(/\*\*Read the roster\.\*\*/);
      expect(loop).toContain("corpus agents");
      const order = [
        "**Read the roster.**",
        "**Claim, then read what it printed.**",
        "**Dispatch every claimed event to a subagent, and launch the listeners the roster asked",
      ].map((label) => loop.indexOf(label));
      expect(order).not.toContain(-1);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(loop).toMatch(/Launching comes \*\*after\*\* the claim rather\s+than before it/);
    });

    /**
     * The one defect the live drill turned up, and it was invisible to reading:
     * a session driven by the text alone launched a listener for a lapsed lane
     * from the roster read and then claimed that lane's work in the same pass.
     * The listener parked, went live, and its **first** scoped claim reported
     * the orchestrator's in-flight events in `inProgress` — because the held
     * report uses the same lane predicate the claim does, so a lane going live
     * moves those rows into the resident's view. The converse skill's
     * reconciliation then had it read the thread, find no answer yet, and do the
     * work the orchestrator's subagent was doing; the orchestrator had to stand
     * its own subagent down mid-flight.
     *
     * Nothing in the product reports this — both agents are behaving correctly
     * against their own skills — so the rule is pinned with the mechanism, not
     * just the prohibition. A rewrite that keeps "launch a listener for every
     * unattended lane" and drops the ordering reintroduces it exactly.
     */
    it("never launches into a lane in the pass it took that lane's work", () => {
      expect(routing).toMatch(/\*\*But never in the same pass you took that lane's work\.\*\*/);
      expect(routing).toMatch(
        /why launching happens after\s+the claim rather than at the roster read/,
      );
      // The mechanism, which is the part a reader cannot rederive.
      expect(routing).toMatch(/still stamped for that lane/);
      expect(routing).toMatch(/in the held list its own first claim prints/);
      expect(routing).toMatch(
        /reconciliation cannot tell your live dispatch from an event\s+somebody abandoned/,
      );
      expect(routing).toMatch(/a reply you did not write/);
      // The rule, and which way it resolves.
      expect(routing).toMatch(/\*\*take the work\s+or launch the listener, never both\.\*\*/);
      expect(routing).toMatch(/Prefer taking the work/);
      expect(routing).toMatch(/Launch on a later pass, once what you took is settled/);
    });

    /**
     * AGENT-029, the orchestrator's half. The launch rule was written as though
     * a not-live row meant an absent listener; presence is the parked request,
     * so it also means a listener mid-turn, and a resident's turns are long by
     * design. The rule does not change — holding back would leave a genuinely
     * dead listener unreplaced, which has no repair — but the reason does, and
     * so does what the skill is allowed to do about it: nothing. The one field
     * that separates the cases is `summary`, which the contract publishes for
     * display and refuses to promise the content of.
     */
    it("knows a not-live row is ambiguous, launches anyway, and invents no separator", () => {
      expect(routing).toMatch(
        /\*\*A row that does not read `live` does not mean nobody is there — and you launch anyway\.\*\*/,
      );
      expect(routing).toMatch(/\*\*and for one in the middle of a\s+turn\*\*/);
      expect(routing).toMatch(
        /any turn\s+longer than the grace window is indistinguishable from an empty lane/,
      );
      expect(routing).toMatch(/`live` is the only\s+reading with a definite meaning/);
      // The forbidden separators, by name — each is a plausible "fix".
      expect(routing).toMatch(
        /no probe, no\s+holding back a pass to see what happens, no reading the lane's busyness/,
      );
      expect(routing).toMatch(/whose length is promised and whose content is not/);
      // Where the duplicate is resolved instead. AGENT-032: the mechanism was
      // restated here and then maintained only in `converse`, so the two
      // disagreed — this skill now carries the outcome it relies on and a
      // pointer, and the restatement is deleted rather than synchronised. The
      // negative matcher runs against the shipped sentence in "one rule, one
      // skill", which is also where the general form of the rule is pinned.
      expect(routing).toMatch(/\*\*Launch, and let\s+the lane settle it\.\*\*/);
      expect(routing).toMatch(
        /one of the two finds out it is\s+second and goes — nothing posted, nothing worked, and nobody answered twice/,
      );
      expect(routing).toMatch(
        /\*\*How it finds\s+that out is the converse skill's to state, and it is stated there alone\.\*\*/,
      );
      expect(routing).toMatch(/on a lane you never claim and never see/);
      expect(routing).toMatch(/you neither run it nor observe it/);
      expect(routing).toMatch(/which is how the two came\s+to disagree once already/);
      expect(routing, "the deleted restatement is back").not.toMatch(
        /its claim comes back empty\s+on work its own park had just named/,
      );
      // And the asymmetry that makes launching the right side to err on.
      expect(routing).toMatch(
        /The failure you would\s+buy by holding back has no repair in it at all/,
      );
      // The window stays the server's number here too.
      for (const restatement of ["16m", "16 minutes", "960"]) {
        expect(routing, `restates the grace window as "${restatement}"`).not.toContain(restatement);
      }
    });

    it("takes what the claim gives it without auditing the walk", () => {
      expect(claiming).toMatch(
        /\*\*What the claim hands you is yours, and you do not audit it\.\*\*/,
      );
      expect(claiming).toMatch(/A live\s+lane's events are never in it/);
      expect(claiming).toMatch(/do not check whether an event's thread has a resident/);
      expect(claiming).toMatch(/do not hold work back for an agent that might come\s+back/);
      // SHARED-044: scope is the walk, never a guarantee of exclusivity. The
      // agent is told what it may reason from — the lane — and nothing more.
      expect(claiming).toMatch(/Scope membership is a \*\*walk\*\*/);
      expect(claiming).toMatch(/following a\s+thread's parents and a document's `origin`/);
      expect(claiming).toMatch(/you cannot reproduce it and nothing asks you to/);
      expect(body).not.toMatch(/belongs to at most one scope/);
      expect(claiming).toMatch(/The event arrived on your claim, so it is yours to work/);
    });

    it("works a lapsed lane's events without saying so in the thread", () => {
      expect(claiming).toMatch(/\*\*A lapsed lane's work is ordinary work/);
      expect(claiming).toMatch(/the same routing\s+row to the same comment-skill subagent/);
      expect(claiming).toMatch(
        /\*\*Never apologise for a resident and never announce that one is missing\.\*\*/,
      );
      expect(claiming).toMatch(/operator's\s+diagnostic posted into somebody's conversation/);
      // Where it does go, and the once-per-lane courtesy that follows it.
      expect(claiming).toMatch(
        /corpus job log evt_2e4f8b "claimed comment.created on th_4b8e2c under the fallback/,
      );
      expect(claiming).toMatch(/launch one for that lane, once/);
      expect(claiming).toMatch(/eight messages while it was unattended gets eight\s+listeners/);
    });

    it("keeps settlement on the report when the held row disappears", () => {
      // Measured: the held report uses the same predicate as the claim, so an
      // event taken under the fallback leaves the list the moment its lane goes
      // live again — while the orchestrator is still working it.
      expect(claiming).toMatch(
        /\*\*A held row can leave your list while you are still working it\.\*\*/,
      );
      expect(claiming).toMatch(/take an event id and no lane/);
      expect(claiming).toMatch(/\*\*settlement follows the report, never the list\.\*\*/);
    });

    it("restates the grace window nowhere", () => {
      expect(body).toMatch(/a grace window the server owns and this skill does not restate/);
      for (const restatement of ["16m", "16 minutes", "960"]) {
        expect(body, `restates the grace window as "${restatement}"`).not.toContain(restatement);
      }
    });

    it("puts a resident outside the delegate-everything rule rather than beside it", () => {
      const delegation = body.slice(body.indexOf("## Delegation"), body.indexOf("## Writing a"));
      expect(delegation).toMatch(
        /\*\*That rule is about this lane, and a resident is outside its subject rather than an exception\s+to it\.\*\*/,
      );
      expect(delegation).toMatch(/you are the queue's general path/);
      expect(delegation).toMatch(/do not "correct" it into a dispatch/);
      // The boundary rule is scoped to the events this lane claimed, and a
      // listener's own queue calls are ownership rather than a violation.
      expect(delegation).toMatch(
        /\*\*Queue state never crosses the boundary — the boundary being your lane\.\*\*/,
      );
      expect(delegation).toMatch(/\*\*A listener is not one of those subagents/);
      expect(delegation).toMatch(/It is that lane's owner, not your delegate on this one/);
      expect(delegation).toMatch(/Nobody settles work they did\s+not claim/);
      expect(delegation).toMatch(/including the\s+events you took from its lane/);
    });

    it("counts working subagents against the bound, never parked listeners", () => {
      const concurrency = body.slice(
        body.indexOf("## Concurrency"),
        body.indexOf("## Progress and job logs"),
      );
      expect(concurrency).toMatch(
        /\*\*The bound counts subagents working events, and a resident listener is not one of those\.\*\*/,
      );
      expect(concurrency).toMatch(/ten designated conversations could dispatch nothing at all/);
      expect(concurrency).toMatch(/limits work in flight, never agents in existence/);
      // Ordering is per lane too: two lanes on one document is the ordinary
      // two-writers case, which the key already governs.
      expect(concurrency).toMatch(/neither can nor\s+should order your work against a resident's/);
      expect(concurrency).toMatch(/the key on the write, not a schedule/);
    });

    it("says which lane a quoted mention wakes, rather than assuming its own", () => {
      const reflecting = body.slice(
        body.indexOf("## Reflecting on a user edit"),
        body.indexOf("## Concurrency"),
      );
      // Measured: an agent turn quoting `@agent` in a designated conversation
      // wakes that conversation's resident and never reaches this claim. A
      // skill claiming otherwise would have the orchestrator watching for
      // something it cannot see.
      expect(reflecting).toMatch(
        /\*\*The turn's lane is where it lands, and it is not always yours\.\*\*/,
      );
      expect(reflecting).toMatch(/enqueues on the lane of the \*\*thread it was posted in\*\*/);
      expect(reflecting).toMatch(/never appears on your claim/);
      expect(reflecting).toMatch(/no marker anywhere saying a machine wrote the\s+mention/);
      expect(reflecting).toMatch(/\*write no `@agent`\* rather than\s+\*detect one\*/);
    });

    it("keeps the reaper lane-blind, and states why that is not a trespass", () => {
      expect(claiming).toMatch(/\*\*`corpus queue reap-stale` takes no lane/);
      expect(claiming).toMatch(
        /work stranded by a resident that died is stuck whoever\s+claimed it/,
      );
      expect(claiming).toMatch(/on \*\*the lane it was claimed from\*\*/);
      expect(claiming).toMatch(/the fallback rather than the reaper decides who may\s+then see it/);
      expect(claiming).toMatch(/a resident never\s+does/);
    });

    it("tells the operator how a broken converse skill looks, and how to put it back", () => {
      const recovery = body.slice(body.indexOf("## If the loop breaks"));
      expect(recovery).toMatch(/use `comment` or `converse` in place of `orchestrate`/);
      // The symptom, which is nothing like a broken loop: the queue is fine and
      // one conversation is not.
      expect(recovery).toMatch(
        /\*\*A broken `converse` shows up differently, and is worth recognising as its own thing\.\*\*/,
      );
      expect(recovery).toMatch(
        /its lane reads live on `corpus agents` while\s+nothing gets answered in it/,
      );
      expect(recovery).toMatch(/the orchestrator quietly does that\s+conversation's work/);
      expect(recovery).toMatch(/listeners already running keep the text they started with/);
      // And the same latency stated where the edit is made rather than only here.
      expect(body).toMatch(/an edit to it reaches the\s+\*\*next listener launched\*\*/);
      expect(body).toMatch(/never restart somebody's listener to hurry it along/);
    });
  });

  /**
   * SHARED-067 removed the plugin system, and with it the `<plugin>.<action>`
   * routing row, the handler-resolution bullet under *Routing*, and the touched
   * set under *Concurrency and ordering*. The **rule** those passages carried
   * outlived its cause and is pinned below rather than deleted with them: an
   * event type this loop does not handle still arrives — a queue carried over
   * from an older workspace, an event written by hand, a server newer than the
   * skill — and it fails loudly, naming what arrived. What may not come back is
   * the dispatch: a row that matches a *shape* of type rather than a named one,
   * which is what routed `<plugin>.<action>` to a skill by its own first token.
   */
  /**
   * AGENT-042, SPEC.md §10 riders 2 and 6 (signed 2026-08-22). `pinned` and a
   * view's `order` were removed rather than deprecated, so what the skill has to
   * teach is the *replacement act*: a column appears because a board document
   * names its id. Three pins here are the ones a rewrite loses first.
   *
   * - **`--columns` is the whole list.** An agent that reads it as an append
   *   takes every other column off the board, at exit 0.
   * - **Omitted `transitions` is not `{}`.** The first is the linear funnel and
   *   the second is a board nothing may be dragged on — measured by CLI-060.
   * - **The confirmation is not always the last line.** A `--stage` that decided
   *   a status prints the server's sentence *after* `edited <id>`, so a skill
   *   that reads one line reports half of what happened.
   */
  describe("a column is a line in a board document", () => {
    const flat = body.replace(/\s+/g, " ");

    it("names no removed key", () => {
      // Rider 2 removed both. A skill naming either teaches a write the CLI
      // refuses, and the flag is not a verb, so the invocation extractor and
      // `REMOVED_VERBS` both look straight past it.
      expect(body, "names --pinned").not.toMatch(/--pinned\b/);
      expect(flat, "still calls a view pinned").not.toMatch(/pinned: true/);
    });

    it("teaches pinning a view as a write to the board", () => {
      expect(flat).toMatch(
        /\*\*A board is a document, so building one is writing a document\.\*\*/,
      );
      expect(flat).toMatch(/"pin me a view" is two writes, and the second one is what pins it/);
      expect(body).toMatch(/corpus doc edit doc_seedboardattention --columns \S+ --from agent/);
      expect(flat).toMatch(
        /\*\*`--columns` is the whole list, in order, and never an append\.\*\*/,
      );
      expect(flat).toMatch(/drops a column takes that column off the board/i);
      // Measured against a real server, 2026-08-22: `corpus doc archive` on the
      // last board succeeds at exit 0. "One board is always showing" is the
      // board bar's refusal (UI-148), so a skill stating it flatly would tell
      // an agent it is protected where it is not.
      expect(flat).toMatch(/\*\*One board is always showing, and the CLI does not enforce that/);
      expect(flat).toMatch(/leaving a workspace with no board on it/);
    });

    it("keeps the two graphs apart, and says which one silence means", () => {
      expect(flat).toMatch(/A kanban is a board over one field, and it is one document/);
      expect(flat).toMatch(/so a kanban carries no `columns` at all/);
      expect(flat).toMatch(/Leaving `transitions` out is not the same as writing it empty/);
      expect(flat).toMatch(/Omit the key and the graph is the linear funnel/);
      expect(flat).toMatch(/`transitions: \{\}` and the graph is one along which nothing may be/);
    });

    it("separates stage from status, and reads past the confirmation", () => {
      expect(flat).toMatch(/Moving a document along a workflow is `--stage`/);
      expect(flat).toMatch(/`stage` says where in a workflow a document sits/);
      expect(flat).toMatch(/`status` says whether work remains/);
      expect(flat).toMatch(/writing a status never moves a stage/i);
      // The output shape, which is the half a parser gets wrong.
      expect(flat).toMatch(/on a \*\*separate line after\*\* `edited <id>`/);
      expect(flat).toMatch(/confirmation is therefore not always the last line/i);
    });
  });

  /**
   * AGENT-042, SPEC.md §7 rider 9 (signed 2026-08-22). Reflection is the second
   * event whose procedure lives in this skill, and every pin below is a way the
   * rider is misread rather than a restatement of it:
   *
   * - a stage change enqueues **nothing**, so the agent must not go looking for
   *   one, and must not read a stage name as an instruction addressed to it;
   * - `since: null` means *everything*, which is `corpus doc list` with the flag
   *   left off — not an empty value, and not "nothing to do";
   * - the digest is posted **even when there is nothing to say**, because a
   *   silent reflection is indistinguishable from one that never ran.
   */
  describe("reflection is an act over the whole corpus", () => {
    const flat = body.replace(/\s+/g, " ");
    const section = body.slice(
      body.indexOf("## Reflecting on the corpus"),
      body.indexOf("## Concurrency and ordering"),
    );

    it("routes the event to a subagent like every other", () => {
      const routing = body.slice(body.indexOf("## Routing"), body.indexOf("## Delegation"));
      expect(routing).toContain("`workspace.reflect`");
      expect(routing).toMatch(/Reflecting on the corpus/);
      expect(section.length, "no reflection section").toBeGreaterThan(400);
    });

    it("says what does not enqueue anything", () => {
      expect(flat).toMatch(
        /\*\*Reflection is an act over the whole corpus, and never a side effect of one change\.\*\*/,
      );
      expect(flat).toMatch(/none of those enqueues anything, and none of them is a message to you/);
    });

    it("gathers the window itself, and pays only for what it reads", () => {
      expect(section).toMatch(/corpus doc list --since \S+/);
      expect(flat).toMatch(/run the same command with \*\*no `--since` at all\*\*/);
      expect(flat).toMatch(/\*\*Read a document only when its list line is not enough\.\*\*/);
      expect(flat).toMatch(/\*\*Your own writes are not new work\.\*\*/);
      expect(flat).toMatch(/carries `lastActor` on every row/);
    });

    it("says a failure leaves the clock, and an ask is never doubled", () => {
      expect(flat).toMatch(/\*\*A failed reflection is safe to retry\.\*\*/);
      expect(flat).toMatch(/clock only moves when the job reaches `processed`/);
      expect(flat).toMatch(/the retry opens the same window/);
      expect(flat).toMatch(/at\s?exit 0, so a second ask is not an error and is also not a second/);
      expect(flat).toMatch(/`--json` carries `pending`, which is the field that tells the two/);
    });

    it("never reads a stage as an instruction", () => {
      expect(flat).toMatch(/\*\*Never read a stage as an instruction\.\*\*/);
      expect(flat).toMatch(/A document in `doing` is not asking you to do it/);
      expect(flat).toMatch(/Report a stage that moved\. Never act on it\./);
    });

    it("posts one digest, window first, and posts it empty too", () => {
      expect(flat).toMatch(/\*\*one standalone thread, the digest\*\*, and exactly one per/);
      expect(flat).toMatch(/since <the payload's timestamp> until <the moment you gathered>/);
      expect(section).toMatch(/^since \S+ until \S+$/m);
      expect(flat).toMatch(
        /\*\*Post the digest even when there is nothing to say, and post it in one line\.\*\*/,
      );
      expect(section).toMatch(/^since \S+ until \S+ — nothing changed, nothing to report\.$/m);
      // Two `thread create` calls in this section, and neither wakes the agent.
      const creates = section.match(/corpus thread create[^\n]*/g) ?? [];
      expect(creates.length).toBe(2);
      for (const create of creates) expect(create).not.toMatch(/--requests-agent/);
      // SERVER-137: the digest is linked to its reflection at creation time and
      // by nothing else — the event's payload names no thread, so a create with
      // no `--job` leaves `lastDigest` null with no error anywhere. And it is
      // standalone: a parented thread carrying the same job is ignored.
      for (const create of creates) {
        expect(create, "a worked digest carries no --job").toMatch(/--job evt_\w+/);
        expect(create, "a worked digest is parented").not.toMatch(/--parent/);
      }
      expect(flat).toMatch(/\*\*No parent\.\*\* It is a standalone thread, so pass no `--parent`/);
      expect(flat).toMatch(/\*\*`--job <the reflect event id>`\.\*\*/);
      expect(flat).toMatch(/\*\*Post it before you settle the event\.\*\*/);
      expect(flat).toMatch(/promoted to the corpus's digest when the event reaches `processed`/);
      expect(flat).toMatch(/\*\*The digest asks for nothing to run\.\*\*/);
      // And no worked digest body mentions the agent, which would wake it on
      // the thread it just posted.
      for (const block of fencedBlocks(section)) {
        expect(block.content, "a worked digest wakes the agent").not.toContain("@agent");
      }
    });
  });

  describe("an event type with no row", () => {
    const routing = body.slice(body.indexOf("## Routing"), body.indexOf("## Delegation"));

    it("dispatches on a named type, never on the shape of one", () => {
      const rows = routing.split("\n").filter((line) => line.startsWith("| "));
      const types = rows
        .map((row) => row.split("|")[1]?.trim() ?? "")
        .filter((type) => type.startsWith("`"));
      expect(types.length, "no routing rows — the guard would pass vacuously").toBeGreaterThan(0);
      for (const type of types) {
        expect(type, `\`${type}\` routes a shape of type rather than a named one`).not.toContain(
          "<",
        );
      }
      // And the catch-all is the last row, so nothing dispatches below it.
      expect(rows.at(-1) ?? "").toContain(
        'corpus queue fail <id> --reason "unknown event type: <type>"',
      );
    });

    it("fails it loudly, and neither completes nor guesses at it", () => {
      expect(routing).toMatch(/\*\*An event type with no row\.\*\*/);
      // The reasons an unhandled type can still reach a claim, which is what
      // makes the rule survive the plugin system that first motivated it.
      expect(routing).toMatch(/a queue carried over from a workspace older\s+than this skill/);
      expect(routing).toMatch(/somebody wrote into `pending\/` by hand/);
      expect(routing).toMatch(/a server emitting\s+something this skill predates/);
      expect(routing).toMatch(/--reason "unknown event type: ledger\.reconciled"/);
      expect(routing).toMatch(/\*\*Never complete it\*\*/);
      expect(routing).toMatch(/\*\*Never derive a handler from its name\*\*/);
      expect(routing).toMatch(/names no skill/);
    });
  });

  it("names no removed surface and hedges nothing", () => {
    // `todos` was the shipped reference plugin and `_fixture` the test one;
    // SHARED-067 deleted both, so a mention here is a leftover rather than a
    // hardwired name (sprint-012 adjudication 1, kept for the same reason).
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
    for (const heredoc of heredocs) expect(heredoc).toMatch(/^<<'CORPUS_EOF'$/);
    expect(body).not.toMatch(/-m "\$\(/);
  });
});

describe("comment skill body", () => {
  const body = documentAt("claude/skills/comment/SKILL.md").body;

  it("carries no skeleton remnants and no dev-harness references", () => {
    for (const marker of ["arrives with agent", "skeleton", "tbd", "<fill", "placeholder"]) {
      expect(body.toLowerCase(), `contains "${marker}"`).not.toContain(marker);
    }
    for (const marker of ["SPEC.md", "CLAUDE.md", "issues/", "npm run", "/implement"]) {
      expect(body, `contains "${marker}"`).not.toContain(marker);
    }
  });

  it("covers the twelve required concerns in its headings", () => {
    // The six pinned keywords are asserted for both skills above; these are the
    // remaining concerns of the issue's section list, so a later edit cannot
    // silently drop routing, engagement or the entry contract.
    const headings = body
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).toLowerCase());
    for (const keyword of [
      "when this runs",
      "inherited invariants",
      "routing",
      "doing the work",
      "engagement",
      "stewardship",
    ]) {
      expect(
        headings.some((heading) => heading.includes(keyword)),
        `no section for "${keyword}"`,
      ).toBe(true);
    }
  });

  it("gives every section a substantive body, not a bare heading", () => {
    const sections = new Map<string, string[]>();
    let current: string | null = null;
    // Fence-aware: the worked examples pass document bodies through heredocs,
    // and a `## ` line inside one is content, not a section of this skill.
    let inFence = false;
    for (const line of body.split("\n")) {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      if (!inFence && line.startsWith("## ")) {
        current = line.slice(3);
        sections.set(current, []);
      } else if (current !== null) {
        sections.get(current)?.push(line);
      }
    }
    expect(sections.size).toBe(12);
    for (const [heading, lines] of sections) {
      expect(
        lines.join("\n").trim().length,
        `"${heading}" is a heading with no substance`,
      ).toBeGreaterThan(400);
    }
  });

  it("states the non-negotiable commands verbatim", () => {
    const rules = [
      "corpus thread show",
      "corpus doc show",
      "corpus doc edit",
      "corpus doc create",
      "corpus doc move",
      "corpus doc archive",
      "corpus thread reply",
      "corpus thread resolve",
      "corpus job log",
      "--from agent",
      "export CORPUS_FROM=agent",
    ];
    for (const rule of rules) expect(body, `missing "${rule}"`).toContain(rule);
  });

  it("draws the read path: content from the tree, state through the CLI", () => {
    expect(body).toMatch(/corpus thread show <id>/);
    expect(body).toMatch(/corpus doc show <id>/);
    expect(body).toMatch(/anchor resolution/i);
    expect(body).toMatch(/data\/docs\//);
    // `.corpus/` is runtime state, never a source the skill parses.
    expect(body).toMatch(/never parse anything under `\.corpus\/`/i);
  });

  it("gives all three thread shapes a read order and a stopping rule", () => {
    for (const shape of ["Anchored", "Whole-document", "Standalone"]) {
      expect(body, `no ${shape} shape`).toContain(`**${shape}**`);
    }
    expect(body).toContain("`parent: null`");
    expect(body).toMatch(/orphaned/);
    expect(body.match(/\bstop\b/gi)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("makes the standalone title an obligation, set through a document edit", () => {
    expect(body).toMatch(/corpus doc edit th_\w+ --title "[^"]+" --from agent/);
    expect(body).toMatch(/a thread is a document/i);
    expect(body).toMatch(/obligation, not an option/i);
  });

  it("routes from the payload's fields, never from the turn text", () => {
    for (const field of ["threadId", "parentId", "turnTs", "mentions", "skills", "unresolved"]) {
      expect(body, `payload field ${field} unnamed`).toContain(field);
    }
    expect(body).toMatch(/never re-parse the turn text/i);
    expect(body).toMatch(/@<subagent>/);
    expect(body).toMatch(/\/<skill>/);
    expect(body).toMatch(/@agent/);
  });

  it("distinguishes a missing target from an archived one and handles both", () => {
    expect(body).toMatch(/\*\*missing\*\*\s+target shows up here/);
    expect(body).toContain('`status: "archived"`');
    expect(body).toMatch(/name the\s+deviation explicitly in the reply/i);
  });

  it("states engagement as the server's doing, with its consequence", () => {
    expect(body).toMatch(/`requested` to `engaged`/);
    expect(body).toMatch(/There is no CLI verb that sets it/i);
    expect(body).toMatch(/\*\*every later user turn\s+re-triggers you\*\*/i);
    expect(body).toMatch(/note only/i);
  });

  /**
   * AGENT-014, SPEC.md §7's rider signed 2026-08-05. This skill used to forbid
   * precisely what the spec now permits — and forbid it on a hazard that no
   * longer exists, since SERVER-062 made a person's reply reopen a resolved
   * thread. Two things are pinned, not one: the reversal, and its limits. The
   * permission's four exclusions are what keep it from becoming "the agent
   * retires its own unanswered questions", and a limit that lives only in SPEC
   * drifts the first time this file is edited. The prohibition is pinned as an
   * absence for the same reason it was wrong to begin with: its reasoning read
   * as sound, so a later editor who finds it plausible would restore it.
   */
  describe("closing a settled thread", () => {
    /**
     * AGENT-047: the judgment — four conditions, four exclusions, the
     * closed-door rule — lives in `references/closure.md`, read before any
     * resolve or suggestion to resolve. The body keeps the trigger, the
     * resolve-rides-on-a-reply rule, and the directed pointer.
     */
    const closure = readTemplateFile("claude/skills/comment/references/closure.md");

    it("keeps the trigger and the pointer in the body", () => {
      expect(body).toMatch(/You may close a settled matter yourself/);
      expect(body).toMatch(/\*\*the resolve rides on the reply that reports\s+the work\*\*/);
      expect(body).toMatch(/never a resolve with no readable turn\s+attached/);
      expect(body).toMatch(
        /before you resolve any thread, or suggest resolving one, read\s+`references\/closure\.md`/,
      );
    });

    it("carries the prohibition in no form, nor the hazard that motivated it", () => {
      expect(commentPackage).not.toMatch(/Do not resolve on the person's behalf/i);
      expect(commentPackage).not.toMatch(/only when they asked for the matter to be closed/i);
      // SERVER-062 made this false. It is the sentence that made the ban look
      // right, so it may not survive the ban.
      expect(commentPackage).not.toMatch(/resolved unilaterally/i);
      expect(commentPackage).not.toMatch(/stops\s+waking you/i);
    });

    it("states the trigger as four conditions holding at once", () => {
      expect(closure).toMatch(/\*\*Close what you asked for and got\.\*\*/);
      expect(closure).toMatch(/all four of these\s+hold at once/);
      expect(closure).toMatch(/you asked the person for feedback or information/);
      expect(closure).toMatch(/they \*\*provided it\*\* — a turn of their own in the thread/);
      expect(closure).toMatch(/you have \*\*used\*\* it/);
      expect(closure).toMatch(/nothing in the thread is still waiting on anyone/);
      // Authorship is deliberately not among them: keying the permission to it
      // would forbid the commonest real shape and permit almost nothing else.
      expect(closure).toMatch(/Who opened the thread is irrelevant/);
      expect(closure).toMatch(/they ask,\s+you need one clarification, they clarify, you finish/);
    });

    it("names all four exclusions, each as a rule rather than a call", () => {
      expect(closure).toMatch(
        /\*\*Four threads you never close\*\*, each a rule rather than a call/,
      );
      expect(closure).toMatch(/\*\*A thread the person never replied to\.\*\*/);
      expect(closure).toMatch(/no amount of elapsed time turns silence into an answer/);
      expect(closure).toMatch(/\*\*A thread holding an unanswered form\.\*\*/);
      // Not qualified by how many of the thread's forms did come back.
      expect(closure).toMatch(/however many of\s+its other forms came back/);
      expect(closure).toMatch(/\*\*An unfinished piece of your own work\.\*\*/);
      expect(closure).toMatch(/marking your own homework done/);
      expect(closure).toMatch(
        /\*\*A question the person put to you that you have not yet answered/,
      );
      // The one case that is neither permitted nor forbidden keeps its old
      // instruction rather than falling through the gap between the two lists.
      expect(closure).toMatch(/\*\*suggest resolving\*\* and leave the control with them/);
    });

    it("rides the resolve on a reply turn that says so in words", () => {
      expect(closure).toMatch(/\*\*The resolve rides on the reply that reports the work\.\*\*/);
      expect(closure).toMatch(/never a resolve with no readable turn attached/);
      // The rule is that there is a turn — not which command runs first, which
      // the author's own reply not reopening its thread makes immaterial.
      expect(closure).toMatch(/Which of the two commands runs first changes nothing/);
      expect(closure).toMatch(/that there \*\*is\*\* a turn changes everything/);
      // Why a silent resolve is not merely terse: with SHARED-018's collapse it
      // is a conversation that folds away unread.
      expect(closure).toMatch(/the board collapses\s+a resolved thread holding nothing unseen/);
      expect(closure).toMatch(/state the closing in the prose, in words/);
      // Practised, not only stated: one reply, one resolve, same act.
      expect(closure).toContain("corpus thread resolve th_4b8e2c --from agent");
      expect(closure).toContain("so I'm closing this thread");
      // The state change goes on the trace line rather than inventing a second
      // convention for reporting it.
      expect(closure).toMatch(
        /↳ updated the rate assumption in \[\[doc_a1b2c3\]\] to 6\.4%; resolved/,
      );
    });

    it("states the reopen rule in both directions", () => {
      expect(closure).toMatch(/\*\*Resolved is a closed door, not a locked one\.\*\*/);
      expect(closure).toMatch(/sets it back to `open` in the same write that appends it/);
      expect(closure).toMatch(/that reply reaches you again with no\s+`@agent` needed/);
      expect(closure).toMatch(/A turn\s+\*\*you\*\* write reopens nothing/);
      // Stated as what resolving costs, because an agent that believes closing
      // is final closes nothing.
      expect(closure).toMatch(/one reply restores the conversation/);
    });

    it("cascades nowhere and treats a second resolve as a no-op", () => {
      expect(closure).toMatch(/\*\*Resolving cascades nowhere\.\*\*/);
      expect(closure).toMatch(/closing\s+a subthread leaves its parent open/);
      expect(closure).toMatch(/closing a parent leaves its children open/);
      expect(closure).toMatch(/prints\s+"already resolved" and changes nothing/);
      expect(closure).toMatch(/not an error/);
    });
  });

  it("stands aside on an open editing session without naming a queue verb", () => {
    // AGENT-022: the trigger is a person's open session, not a refusal — the
    // write would land, and a text implying otherwise defers work it should do.
    expect(body).toMatch(/Nothing refuses the write and it would land/);
    // The job-log line carries no `deferred:` prefix — the defer status says
    // that now (AGENT-007) — and the dead protocol survives nowhere.
    expect(body).toContain(
      'corpus job log evt_7c1d9a "stood aside on [[doc_a1b2c3]] — a person has an edit session open"',
    );
    expect(body).not.toMatch(/deferred:/);
    // Queue state stays with orchestrate (sprint-014 Adjudication 11): the
    // comment skill hands the event back and never gains the defer verb.
    expect(body).toMatch(/hand the event back to the\s+orchestrate skill/i);
    expect(body).not.toContain("corpus queue defer");
    // Re-entry is automatic; nobody is told to retry by hand.
    expect(body).toMatch(/re-enters by itself/);
    expect(body).not.toContain("corpus job retry");
  });

  it("makes reply mechanics exact", () => {
    expect(body).toMatch(/corpus thread reply th_\w+ --from agent --model \S+ <<'CORPUS_EOF'/);
    expect(body).toMatch(/Never post a reply by editing the thread file/i);
    expect(body).toMatch(/Always reply/i);
    expect(body).toMatch(/pending indicator/i);
    expect(body).toContain("[[id]]");
    expect(body).toMatch(/Length follows the work/i);
  });

  it("files the inbox concretely and names its convention", () => {
    // AGENT-047: the body keeps recognition, the pointer, and the two rules
    // that bind before the read; the procedure lives in the filing reference.
    expect(body).toContain("data/docs/inbox/");
    expect(body).toMatch(/read\s+`references\/inbox-filing\.md` before you file/);
    expect(body).toMatch(/leave it in `inbox\/` and ask/i);
    expect(body).toMatch(/Expansion adds structure, never content/i);
    const filing = readTemplateFile("claude/skills/comment/references/inbox-filing.md");
    expect(filing).toContain("corpus doc move <id> --folder finance --from agent");
    expect(filing).toContain("--add-tag");
    expect(filing).toMatch(/prefer\s+one that already holds similar documents/i);
    expect(filing).toMatch(/leave it in `inbox\/` and ask/i);
    expect(filing).toMatch(/Expansion adds structure, never content/i);
  });

  /**
   * Forms (AGENT-017, SPEC.md §6 + §7's "asking with a form" rider signed
   * 2026-08-05). CONTRACT-038 and UI-084 made a form worth reaching for; this
   * section is the only thing that makes the agent reach for one, so what is
   * pinned here is the *instruction* — ask with a form, batch the questions —
   * and not merely the presence of the word "form".
   */
  describe("forms", () => {
    /**
     * AGENT-047: the decision rules stay in the body — they are what makes an
     * agent reach for a form at all — and the grammar, the worked example and
     * the answer's shape live in `references/forms.md`, read before a form is
     * written and again when a `form.respond` arrives.
     */
    const grammar = readTemplateFile("claude/skills/comment/references/forms.md");
    /** The worked ```` ```form ```` example, which is a real multi-field ask. */
    const example = fencedBlocks(grammar).find((block) => block.info === "form");

    it("directs the read at both moments the grammar is needed", () => {
      expect(body).toMatch(
        /grammar, the field kinds, and the answer's shape live in `references\/forms\.md`/i,
      );
      expect(body).toMatch(/before you write a form fence/i);
      expect(body).toMatch(/again when a `form\.respond` event arrives/i);
      // And the form.respond entry point sends its reader the same way.
      expect(body).toMatch(/Before acting on one, read\s+`references\/forms\.md`/);
    });

    it("makes a form the default shape for a turn whose purpose is to ask", () => {
      expect(body).toMatch(/When a turn's purpose is to get something from the person, ask with/);
      // The asymmetry that is the whole reason to prefer one (SPEC.md §10):
      // a prose question stops signalling the moment the thread is read.
      expect(body).toMatch(/awaiting your answer/);
      expect(body).toMatch(/Reading a question is not\s+answering it/);
      // And the exclusion, which guards the opposite failure.
      expect(body).toMatch(/An open question is not a form; it is a reply/);
    });

    it("states the batching rule, in the register of an instruction", () => {
      expect(body).toMatch(/Ask the whole batch at once/i);
      expect(body).toMatch(/\*\*one\s+form, in one turn\*\*/);
      expect(body).toMatch(/never one question per turn/i);
      // Batching is "everything you need", never a minimum field count.
      expect(body).toMatch(/a form with\s+a single field is still right/i);
      // The routing bullet reaches the agent where it decides what to do, not
      // only in the section it would have to already be reading.
      expect(body).toMatch(/\*\*Ask with a form\*\* when the turn's purpose/);
    });

    it("tells the agent to mark optional generously, and why", () => {
      expect(grammar).toMatch(/required unless it\s+carries `optional: true`/);
      expect(grammar).toMatch(/Mark generously/);
      expect(grammar).toMatch(/more optional fields, never fewer forms/i);
      expect(grammar).toMatch(/short enough to read as a control/i);
      expect(grammar).toMatch(/what you will do with the answers/i);
    });

    it("documents the three kinds and shows a genuinely multi-field example", () => {
      expect(grammar).toContain("```form\nfields:\n");
      expect(grammar).toContain("kind: choose one");
      expect(grammar).toContain("kind: choose any");
      expect(grammar).toContain("kind: write");
      expect(grammar).toContain("optional: true");
      expect(grammar).toContain("options:");
      expect(grammar).not.toContain("~~~");
      expect(grammar).toMatch(/there is no fourth kind/i);
      expect(grammar).toMatch(/distinct within the\s+form/i);
      expect(grammar).toMatch(/at most one form per\s+turn/i);
      // A one-field example is what produces one question per turn, so the
      // example is a decision, a selection and a fact — one of them optional.
      const questions = example?.content.match(/^\s*- question: /gm) ?? [];
      expect(questions.length, "the worked form is not a multi-field ask").toBeGreaterThanOrEqual(
        3,
      );
      expect(example?.content).toContain("optional: true");
      expect(example?.content).toContain("kind: choose any");
    });

    it("drops the two stale claims, one of which SERVER-068 made false", () => {
      // A malformed form is refused at write time now; a skill teaching a
      // grammar nothing checks would be teaching the wrong posture entirely.
      expect(grammar).not.toMatch(/nothing validates the block when it is posted/i);
      expect(grammar).toMatch(/the server refuses the whole turn with a `400`/i);
      expect(body).toMatch(/the server refuses the whole turn with a `400`/i);
      // `choose any` exists, so the answer is no longer one option verbatim.
      expect(grammar).not.toMatch(/single-select/i);
    });

    it("states that the agent never answers a form, including its own", () => {
      expect(grammar).toMatch(/You never answer a form — not the person's, and not your own/);
      expect(grammar).toMatch(/the server refuses an answer from you/i);
    });

    it("resumes from the richer payload, keyed to the questions", () => {
      for (const field of ["formTs", "answers", "question", "kind", "option", "note"]) {
        expect(body, `form.respond field ${field} unnamed`).toContain(field);
      }
      expect(grammar).toMatch(/no\s+`parentId`/i);
      expect(grammar).toMatch(/continuation, not a new request/i);
      expect(grammar).toMatch(wrapped("never re-ask, never re-explain from the top"));
      expect(grammar).toMatch(/keyed to its question/i);
      // The two answers that are easy to mishandle: a blank optional field is a
      // complete answer, and a prose reply is not an answer at all.
      expect(grammar).toMatch(wrapped("Every optional field left blank is a **complete** answer"));
      expect(grammar).toMatch(/never resolve the thread to make the row go\s+away/);
    });
  });

  it("states skill genesis: threshold, destination, mechanism, announcement, conflicts", () => {
    // AGENT-047: the threshold and the two hard rules stay in the body; the
    // destination choice and the creation mechanics live in the genesis
    // reference, read before any skill is created or edited.
    expect(body).toMatch(/stated more than once/i);
    expect(body).toMatch(/read `references\/skill-genesis\.md`/i);
    const genesis = readTemplateFile("claude/skills/comment/references/skill-genesis.md");
    // Extend-first stays the default; creation is for when nothing fits.
    expect(genesis).toMatch(/Extend an existing skill when one fits/i);
    expect(genesis).toMatch(/Create a genuinely new skill when nothing installed fits/i);
    // AGENT-006: the creation branch names the shipped verb (CLI-011), and the
    // propose-a-note path is gone — one documented way, not two.
    // AGENT-035 moved the placeholder from `"<one line>"` to `"$description"`:
    // the description is somebody's words, so it arrives through a heredoc.
    expect(genesis).toContain(
      'corpus skill create <name> --description "$description" --from agent',
    );
    expect(commentPackage).not.toMatch(/Propose a genuinely new skill/i);
    expect(commentPackage).not.toMatch(/cannot write into `\.claude\/`/i);
    // The two rules bind in both places: the body repeats them because they
    // gate acts the reference-read may arrive too late for.
    for (const text of [body, genesis]) {
      expect(text).toMatch(/an \*\*edit to that\s+skill\*\*, never a second skill/i);
      expect(text).toMatch(/Announce it in the reply/i);
      expect(text).toMatch(/\*\*next\*\* run of the loop/i);
    }
  });

  it("states what the server owns about skill creation, as outcomes not pre-checks", () => {
    const genesis = readTemplateFile("claude/skills/comment/references/skill-genesis.md");
    // TEST-411/412/413: name grammar, install/archive collision with the right
    // recovery, required description, dual frontmatter, and the ways back.
    expect(genesis).toMatch(/lowercase letters, digits and single hyphens, at most 64 characters/);
    expect(genesis).toContain("`400`");
    expect(genesis).toMatch(/installed \*\*or archived\*\* is a `409`/);
    expect(genesis).toMatch(/`409` means unarchive it/);
    expect(genesis).toMatch(/`--description` is required/);
    expect(genesis).toContain(".claude/skills/<name>/SKILL.md");
    expect(genesis).toMatch(/\*\*both\*\* frontmatter vocabularies\s+written by the server/i);
    // SHARED-042: the ways back are the ordinary ones. Archiving disables a
    // skill; a wording it regrets is reverted the way any document is, so the
    // branch points at the revert loop rather than at a verb that no longer
    // exists.
    expect(genesis).toMatch(/read the history, write the old text back with the key/i);
    expect(genesis).toMatch(/corpus doc archive/);
    expect(genesis).toMatch(/do not pre-check/i);
  });

  it("bounds stewardship and forbids deletion", () => {
    expect(body).toMatch(/leave it better than you\s+found it/i);
    expect(body).toMatch(/Archive, never delete/i);
    expect(body).toMatch(/deletion is the user's alone/i);
  });

  /**
   * AGENT-020's half of the rule, where this skill needs it: a subagent working
   * a thread sees plenty it was not sent for, and the old reflex — open a thread
   * about it — is exactly what buried the threads that wanted an answer.
   */
  it("sends what it notices to the changelog rather than to a new thread", () => {
    expect(body).toMatch(
      /\*\*What you notice about a document goes in its changelog, never into a new thread\.\*\*/,
    );
    expect(body).toContain("`## Changelog`");
    expect(body).toMatch(/one entry appended after the last one/);
    expect(body).toMatch(/the rest of the body passed back\s+through byte for byte/);
    // Append, with the reason that makes the rule survive an optimising reader.
    expect(body).toMatch(/Never rewrite the section/);
    expect(body).toMatch(/how their writing disappears/);
    expect(body).toMatch(/every thread anchored into an entry you rewrote comes loose/);
    // The one door to a thread, and the cost of using it for anything else.
    expect(body).toMatch(/A thread means _I need something from you_/);
    expect(body).toMatch(/buries the\s+threads that are waiting for an answer/);
    expect(body).toMatch(/you ask for the decision with a form/);
  });

  /**
   * SHARED-067 deleted *Route into a plugin* from the moves under *Doing the
   * work*. Applying another skill did not go with it — it is what a `/<skill>`
   * on the turn asks for — but it is a **directive the payload carries**, and
   * *Routing directives* states it in full one section earlier. So the moves
   * list is now the writes this skill makes itself, and the handing-off it
   * still does is a mention or a skill the server parsed, never a domain a
   * `<plugin>`-shaped path owns.
   */
  it("hands off only on a directive the payload carries", () => {
    const directives = body.slice(body.indexOf("## Routing directives"), body.indexOf("## Doing"));
    expect(directives).toMatch(
      /A `\/<skill>` invocation is a directive to \*\*apply\*\* that skill/,
    );
    expect(directives).toMatch(/`@<subagent> \/<skill>` means/);
    // The moves list writes through the CLI and delegates to a subagent; it
    // names no installed path that would own a kind of document.
    const doingTheWork = body.slice(body.indexOf("## Doing the work"), body.indexOf("## Inbox"));
    expect(doingTheWork).toMatch(/\*\*Spawn a subagent\*\*/);
    expect(doingTheWork).not.toMatch(/\.claude\/skills\/</);
    expect(body).not.toMatch(/todos|_fixture/i);
  });

  it("covers the named edge cases", () => {
    for (const rule of [
      /anchor is orphaned/i,
      /never try to repair the `anchors` map by hand/i,
      /parent document was deleted/i,
      /Never recreate it/i,
      /attachment-only/i,
      /note-only/i,
      /standalone thread stays trivial/i,
      /thread is about a skill document/i,
      // SHARED-042: the undo it offers the person is the revert loop, not a verb.
      /one read of the history and one write away/i,
      /Acknowledge immediately/i,
    ]) {
      expect(body, `no edge case matching ${String(rule)}`).toMatch(rule);
    }
  });

  it("carries four worked examples, each with runnable commands", () => {
    // AGENT-047: the examples live in the worked-examples reference, pointed
    // at from "When this runs"; each is still swept for models and traces.
    expect(body).toMatch(/are in `references\/worked-examples\.md`/);
    const worked = readTemplateFile("claude/skills/comment/references/worked-examples.md");
    const examples = worked.split("\n").filter((line) => /^\*\*\d+ — /.test(line));
    expect(examples).toHaveLength(4);
    expect(worked).toMatch(/\*\*1 — Anchored comment/);
    expect(worked).toMatch(/\*\*2 — Standalone Ask/);
    expect(worked).toMatch(/\*\*3 — Inbox capture/);
    expect(worked).toMatch(/\*\*4 — A `form\.respond` continuation/);
  });

  it("does not restate the orchestrate skill's loop, in the body or any reference", () => {
    expect(commentPackage).not.toMatch(/corpus queue (?:claim-all|idle|halt|resume|reap-stale)/);
    expect(commentPackage).not.toContain(".corpus/HALT");
    expect(body).toContain("orchestrate skill");
  });

  it("hedges nothing and quotes every multi-line argument", () => {
    for (const hedge of [
      "use your judgment",
      "consider whether",
      "you may want",
      "if appropriate",
    ]) {
      expect(body.toLowerCase(), `hedges with "${hedge}"`).not.toContain(hedge);
    }
    const heredocs = body.match(/<<-?\s*\S+/g) ?? [];
    expect(heredocs.length).toBeGreaterThan(0);
    for (const heredoc of heredocs) expect(heredoc).toMatch(/^<<'CORPUS_EOF'$/);
    expect(body).not.toMatch(/-m "\$\(/);
  });
});

/**
 * AGENT-047 — the comment skill was read whole by a dispatched subagent on
 * every event: 15,228 tokens (10,401 words) against 376–2,254 tokens of CLI
 * traffic for the same event, 56% of everything the loop spent on a projected
 * 30-event day (SHARED-070). The restructure moves the grammars a given event
 * makes optional into `references/` files read on a directed pointer, and
 * deletes the dispatch prompt's ~1,000-token restatement of the binding rules.
 * After it, the body measures 6,771 words / ~9.5k tokens and the per-event
 * fixed payload fell ~43%.
 *
 * What is pinned is what a later edit silently loses:
 *
 * - **The budget** — a body drifting back toward its old size fails with a
 *   number attached, which is how this issue stays fixed.
 * - **Directed reads** — every shipped reference is pointed at from the body
 *   by path; a reference nothing directs a read at is worse than inline text,
 *   because the runtime pays for it never and the rule in it binds nobody.
 * - **References are skill payload, not documents** — no frontmatter, excluded
 *   from the document loader, never projected (a skill root admits only
 *   `SKILL.md`), and told to the subagent as such so the retrieval doctrine
 *   does not read the directed read as a forbidden disk read.
 * - **One copy of the invariants per dispatch** — the skill's own section for
 *   the two comment routing rows, the prompt for the two reflections, never
 *   both.
 */
describe("progressive disclosure in the comment skill (AGENT-047)", () => {
  const body = documentAt("claude/skills/comment/SKILL.md").body;

  it("keeps the body inside the budget the restructure bought", () => {
    const words = body.split(/\s+/).filter((word) => word !== "").length;
    expect(words).toBeLessThan(7000);
  });

  it("points at every reference it ships, and ships every reference it points at", () => {
    const shipped = skillReferences
      .map(({ label }) => label.replace("assets/workspace/claude/skills/comment/", ""))
      .sort();
    expect(shipped, "the reference tree is empty — the plan no longer sees it").not.toEqual([]);
    const pointed = [
      ...new Set([...body.matchAll(/references\/[a-z-]+\.md/g)].map((match) => match[0])),
    ].sort();
    expect(pointed).toEqual(shipped);
    // Directed reads, not mentions: the imperative appears with each pointer.
    const directed = body.match(
      /read\s+`references\/[a-z-]+\.md`|`references\/[a-z-]+\.md`[^.]{0,60}\bread\b|are in `references\/worked-examples\.md`/gi,
    );
    expect(directed?.length ?? 0).toBeGreaterThanOrEqual(skillReferences.length);
  });

  it("gives no reference frontmatter, and excludes each for that reason", () => {
    expect(skillReferences).toHaveLength(7);
    for (const { label, body: text } of skillReferences) {
      expect(text.startsWith("---"), `${label} grew frontmatter`).toBe(false);
      expect(text.startsWith("# "), `${label} opens with no title`).toBe(true);
      expect(isNonDocument(label.replace("assets/workspace/", "")), label).toBe(true);
    }
  });

  it("carries no dev-harness references in any reference file", () => {
    for (const { label, body: text } of skillReferences) {
      for (const marker of ["SPEC.md", "CLAUDE.md", "issues/", "npm run", "/implement"]) {
        expect(text, `${label} contains "${marker}"`).not.toContain(marker);
      }
      for (const hedge of ["use your judgment", "consider whether", "you may want"]) {
        expect(text.toLowerCase(), `${label} hedges with "${hedge}"`).not.toContain(hedge);
      }
    }
  });

  it("tells the subagent a reference is skill payload, outside the retrieval rules", () => {
    expect(body).toMatch(/part of this skill, not a document in the corpus/);
    expect(body).toMatch(wrapped("read it directly, at the path this text names"));
  });

  it("states the invariants to a comment subagent exactly once — in the skill", () => {
    const orchestrate = documentAt("claude/skills/orchestrate/SKILL.md").body;
    expect(orchestrate).toMatch(wrapped("exactly one document states them to it"));
    expect(orchestrate).toMatch(
      wrapped(
        "A dispatch that names a skill — the comment skill's two routing rows — restates nothing",
      ),
    );
    expect(orchestrate).toMatch(wrapped("Name the skill and let it speak"));
    // The reflections still get the rules in their prompts — they read no skill.
    expect(orchestrate).toMatch(
      wrapped("reads no skill of its own, so its prompt is the only road the rules have into it"),
    );
    // The worked example practices the deletion rather than contradicting it.
    expect(orchestrate).toMatch(wrapped("no restatement of the binding rules"));
    // And the comment skill's own section says the prompt carries no copy.
    expect(body).toMatch(/there is no second copy in the prompt/);
  });
});

/**
 * AGENT-046, decided by the user 2026-08-23: adopt the folder verbs, bounded.
 * A skill uses `corpus folder archive|unarchive|rename` only where the folder
 * is what the person named; bulk stewardship the agent decided on itself stays
 * per document, because the agent chose those documents and must be able to
 * name each one. The boundary is written as a **rule**, per the decision — an
 * example of the safe case is not a rule against the unsafe one. `corpus
 * folder delete` stays the user's: measured 2026-08-23, `--from agent` is
 * refused at exit 2 before any request is sent, naming the archive detour.
 */
describe("folder acts are bounded by who named the folder (AGENT-046)", () => {
  const comment = documentAt("claude/skills/comment/SKILL.md").body;
  const orchestrate = documentAt("claude/skills/orchestrate/SKILL.md").body;

  it("teaches the verbs at the point a request arrives, as a rule", () => {
    expect(comment).toMatch(
      wrapped("**Act on a whole folder only where the folder is what the person named.**"),
    );
    expect(comment).toMatch(wrapped("a rule, not a preference"));
    expect(comment).toContain("corpus folder archive <path>");
    expect(comment).toContain("corpus folder unarchive <path>");
    expect(comment).toContain("corpus folder rename <from> <to>");
    // The bulk act reaches documents the request never mentioned — the reason
    // the boundary exists — and the reply states the count.
    expect(comment).toMatch(wrapped("names documents the request never mentioned"));
    expect(comment).toMatch(wrapped("state the count in the reply"));
    // The other half of the rule: agent-chosen work stays per document.
    expect(comment).toMatch(wrapped("Where **you** picked the documents"));
    expect(comment).toMatch(wrapped("a folder verb never inherits that judgment"));
  });

  it("keeps deletion the user's, with the archive detour stated", () => {
    expect(comment).toMatch(
      wrapped(
        "`corpus folder delete` is the user's alone and the CLI refuses it from you at exit `2`",
      ),
    );
    expect(comment).toMatch(wrapped("archive it and say that deletion is theirs"));
  });

  it("bounds the stewardship charter the same way, in orchestrate", () => {
    expect(orchestrate).toMatch(
      wrapped(
        "**A folder verb serves a request that named the folder, and it never serves this charter.**",
      ),
    );
    expect(orchestrate).toMatch(wrapped("stewardship picks its documents one by one"));
    // The charter's own bullets stay per document.
    expect(orchestrate).toMatch(wrapped("The two bullets above stay per document"));
  });
});

/**
 * AGENT-025 — the **converse** skill, a resident's own loop (SPEC.md §7 as
 * amended by SHARED-043).
 *
 * What is pinned here is only what a plausible-looking rewrite gets wrong, and
 * every one of the four has a failure that is silent in the running product:
 *
 * - **The lane is carried explicitly, or the resident works the wrong queue.**
 *   An omitted `--thread` is not an error — it means the *orchestrator's* lane —
 *   so a worked example missing the flag teaches a listener to claim and park on
 *   somebody else's conversation, and nothing anywhere reports it. That is why
 *   the flag is checked mechanically on every queue command the skill *works*,
 *   not merely asserted in prose.
 * - **Inline work is doctrine, not an oversight.** §7 is careful that a resident
 *   is *outside* the delegate-everything rule's subject rather than an exception
 *   to it, so the skill has to carry the reason or a later editor "fixes" it
 *   back into dispatch and deletes the whole point of a resident.
 * - **Presence is the parked request and nothing else.** Any keep-alive, any
 *   registration, any shortened park is a second and lying account of presence.
 * - **A lapse is not breakage.** A resident that treats the orchestrator's
 *   fallback as a failure re-does work that was already done, in a conversation
 *   the person is reading.
 */
describe("converse skill body", () => {
  const body = documentAt("claude/skills/converse/SKILL.md").body;

  it("carries no skeleton remnants and no dev-harness references", () => {
    for (const marker of ["arrives with agent", "skeleton", "tbd", "<fill", "placeholder"]) {
      expect(body.toLowerCase(), `contains "${marker}"`).not.toContain(marker);
    }
    for (const marker of ["SPEC.md", "CLAUDE.md", "issues/", "/implement", "/decompose"]) {
      expect(body, `contains "${marker}"`).not.toContain(marker);
    }
  });

  it("gives every section a substantive body, not a bare heading", () => {
    const sections = new Map<string, string[]>();
    let current: string | null = null;
    let inFence = false;
    for (const line of body.split("\n")) {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      if (!inFence && line.startsWith("## ")) {
        current = line.slice(3);
        sections.set(current, []);
      } else if (current !== null) {
        sections.get(current)?.push(line);
      }
    }
    expect(sections.size).toBe(15);
    for (const [heading, lines] of sections) {
      expect(
        lines.join("\n").trim().length,
        `"${heading}" is a heading with no substance`,
      ).toBeGreaterThan(400);
    }
  });

  describe("the lane is carried explicitly", () => {
    /** Every `corpus queue …` the skill actually *works*, as opposed to naming in prose. */
    const workedQueueUses = fencedBlocks(body)
      .filter((block) => block.info === "bash")
      // The extractor reads code, so the fence has to be put back around the
      // block's content — handed bare lines it finds nothing and every
      // assertion below would pass over an empty set.
      .flatMap((block) => extractCorpusInvocationUses(["```bash", block.content, "```"].join("\n")))
      .filter(({ tokens }) => tokens[0] === "queue");

    it("spells --thread on every scoped queue command it works", () => {
      const scoped = workedQueueUses.filter(
        ({ tokens }) => tokens[1] === "idle" || tokens[1] === "claim-all",
      );
      // Anti-vacuity in both directions: some example has to claim and some
      // example has to park, or "every one carries the flag" holds over nothing.
      expect(scoped.filter(({ tokens }) => tokens[1] === "claim-all").length).toBeGreaterThan(0);
      expect(scoped.filter(({ tokens }) => tokens[1] === "idle").length).toBeGreaterThan(0);
      for (const use of scoped) {
        expect(use.flags, `\`corpus ${use.tokens.join(" ")}\` with no lane`).toContain("--thread");
      }
    });

    it("works no queue command that would reach another lane", () => {
      // `reap-stale` takes no lane, so it reaps every one of them; the skill
      // rules it out in prose and must not then show it in a copyable block.
      for (const use of workedQueueUses) {
        expect(use.tokens[1], "a lane-less queue command in a worked block").not.toBe("reap-stale");
      }
      expect(body).toMatch(/`corpus queue reap-stale` is not yours to run/);
      expect(body).toMatch(/it reaches every lane/);
    });

    it("invents no environment variable for the lane, and says why", () => {
      expect(body, "invents a lane variable").not.toMatch(/CORPUS_LANE/);
      expect(body).toMatch(/There is no environment variable for a lane/);
      // The asymmetry that makes a variable worse here than elsewhere, in the
      // form SERVER-118 left it: there are now two kinds of wrong lane, and the
      // refusal fires on the kind a variable never produces. The flat claim
      // ("a wrong lane is honoured in silence") is false as stated, because one
      // wrong lane — a thread designating nobody — is refused at the park.
      expect(body, "the flat pre-SERVER-118 claim is back").not.toMatch(
        /but a wrong lane is honoured in\s+silence/,
      );
      expect(body).toMatch(
        /a wrong `CORPUS_JOB` is refused, and so is a `--thread` naming a thread that has no\s+resident/,
      );
      expect(body).toMatch(/neither refusal can fire on the mistake a variable makes/);
      expect(body).toMatch(
        /\*\*A value you\s+inherited rather than typed names a lane that is entirely real: somebody else's live\s+conversation\.\*\*/,
      );
      expect(body).toMatch(/That is honoured in silence/);
      // An omission is not a typo: it is a different, valid lane.
      expect(body).toMatch(/worse than a typo, because it is not\s+an error at all/);
      expect(body).toMatch(/`--thread orchestrator` is refused as a\s+usage error/);
      expect(body).toMatch(/exactly one spelling, which is the absent flag/);
    });
  });

  it("states inline work as outside the delegation rule, never as an exception", () => {
    expect(body).toMatch(/\*\*1\. You work your conversation inline\.\*\*/);
    expect(body).toMatch(
      /\*\*not an\s+exception\*\* to that rule — it is outside the rule's subject/,
    );
    // The reason, which is what stops a later editor restoring the dispatch.
    expect(body).toMatch(
      /you hold one lane, and every other lane, the\s+orchestrator's included, keeps moving/,
    );
    expect(body).toMatch(/Delegation would give that away and buy nothing back/);
    // And the boundary: two departures, and inventing a third is a mistake.
    expect(body).toMatch(/\*\*Everything else binds unchanged\.\*\*/);
    expect(body).toMatch(/treat any third one you find yourself\s+inventing as a mistake/);
  });

  /**
   * AGENT-038. The user named three properties and asked that they be relied
   * on: *"take events and process them serially, without using more subagents.
   * The goal is for them to keep a full conversation in their context without
   * jumping back and forth from subagent to subagent."* All three were true of
   * this file the day the request arrived, and nothing held any of them — they
   * live in three different sections, and an editor tidying one would have been
   * told nothing by anything in this suite.
   *
   * Each test below owns a different sentence, so each falsifies on its own.
   * What they pin is the **consequence** in each case — the conversation is
   * answered in this session, the events are worked in the conversation's own
   * order, and a dispatch carries no lane across the boundary — never how the
   * queue, the server or the subagent runtime brings that about, which is
   * somebody else's to change (AGENT-036).
   */
  describe("a resident works serially, inline, and in one context", () => {
    it("answers in this session, and its worked example answers there too", () => {
      expect(body).toMatch(
        wrapped("you read, you decide, you write, and you reply, in this session, in the context"),
      );
      // What the property buys, which is what stops a later editor "fixing" it
      // back into a dispatch.
      expect(body).toMatch(
        wrapped("remembers the last four exchanges without being briefed on them"),
      );
      // AGENT-019's shape: an example that dispatched would beat the rule above
      // it, so the one worked turn has to be worked where the rule says.
      expect(body).toMatch(
        wrapped(
          "no dispatch, because there is nothing here a subagent would do better than the agent that has been in the conversation since the first message",
        ),
      );
    });

    it("works one claimed event at a time, in the conversation's order", () => {
      expect(body).toMatch(
        wrapped(
          "**Work each claimed event one at a time, in the order the conversation has them.**",
        ),
      );
      // Measured against a real server, 2026-08-19 (the drill in AGENT-038's E2E
      // log): three replies posted inside one second came back from
      // `corpus queue claim-all --thread` as Y, Z, X — the first message last,
      // because a pending batch is a `readdir` and an event id sorts at random
      // against the turn it belongs to. So a skill saying "in claim order" would
      // have told the resident to answer the third message before the first.
      // The order it works in is the thread's, which it is already holding.
      expect(body).toMatch(wrapped("the order that governs is the thread's rather than"));
      expect(body).toMatch(wrapped("take the earliest turn you are holding first"));
      // And where that order is read, so the instruction is executable rather
      // than an intention.
      expect(body).toMatch(wrapped("You read that order in `corpus thread show th_4b8e2c`"));
      expect(body).toMatch(wrapped("each event's payload names the turn it belongs to"));
      expect(body).toMatch(
        wrapped("There is no overlap set to compute here and nothing to run in parallel"),
      );
      expect(body).toMatch(
        wrapped(
          "answering the second message against a corpus where the first has not happened is worse than answering it a minute later",
        ),
      );
      // Serial to the end of each event, not merely at the claim: settling
      // trails the work rather than being swept up at the end of the batch.
      expect(body).toMatch(wrapped("**Settle each event as you finish it**"));
    });

    it("hands a launched subagent no lane, so the conversation stays in one place", () => {
      expect(body).toMatch(
        wrapped(
          "Two things a dispatch never carries across the boundary: your queue state and your lane",
        ),
      );
      expect(body).toMatch(wrapped("never runs a claim, a park, or a terminal call"));
      expect(body).toMatch(
        wrapped("it is given no thread id to scope one with — it reports, and you record"),
      );
      // The resident keeps the event across the dispatch, which is what makes a
      // side task a tool call rather than a handoff of the conversation.
      expect(body).toMatch(
        wrapped("you hold the event while it runs, and you settle from a report you have in hand"),
      );
    });
  });

  /**
   * AGENT-038 / SHARED-055, signed 2026-08-19. The clause this replaces told the
   * resident that a stated weight governed *"the work you are about to do —
   * including your own"*. A resident is a running session on a fixed model, so
   * that instruction cannot be carried out, and its failure path — say so twice
   * — cannot fire either, because nothing signals to the session that it did not
   * happen. The report would have looked right and the discarded choice would
   * have been invisible.
   *
   * The rider settles it at the source: a resident's weight is set when it is
   * designated, and a weight stated on a message governs what the resident hands
   * off. So the pins below are on the two halves of that division, on the two
   * things a designation can say (a weight, or nothing, which means the launcher
   * chose), and on the ending a changed designation weight produces — stated as
   * what the resident does, with no claim about how a launcher or a server
   * arranges it.
   */
  describe("a resident's weight is its designation's", () => {
    it("no longer tells the session to change what it is running as", () => {
      expect(body, "the unsatisfiable clause is back").not.toMatch(/including your own/);
      expect(body, "a message weight is back to governing the resident's turn").not.toMatch(
        /governs the work you are about to do/,
      );
      expect(body).toMatch(
        wrapped("**Your own weight is your designation's, and no message changes it.**"),
      );
      // The reason it cannot reach the resident's own turn, which is what stops
      // the clause being restored as a courtesy to the symmetry.
      expect(body).toMatch(
        wrapped(
          "becoming another one would mean discarding this conversation, which is the thing you are here to hold",
        ),
      );
      expect(body).toMatch(wrapped("governs what you **hand off** and never your own turn"));
      expect(body).toMatch(
        wrapped("There is nothing in it for you to honour or to fail on your own account"),
      );
    });

    it("keeps the stated weight binding on what the resident hands off", () => {
      expect(body).toMatch(
        wrapped("**A weight stated on a message is a directive over what you hand off.**"),
      );
      expect(body).toMatch(wrapped("the stage you delegate runs at it"));
      expect(body).toMatch(
        wrapped("You honour it rather than weighing it again, in either direction"),
      );
      // The "say so twice" path is kept exactly where it can still fire: a
      // hand-off the resident could not make at the weight it was given.
      expect(body).toMatch(
        wrapped("Where a hand-off cannot be made at it, do the work anyway and say so twice"),
      );
      expect(body).toMatch(
        wrapped("in the job's log while it runs, and in the reply the person receives"),
      );
    });

    it("says what a designation carrying no weight means, and what to say once", () => {
      expect(body).toMatch(
        wrapped(
          "**Where the designation carries no weight, the launcher chose one and said which**",
        ),
      );
      expect(body).toMatch(wrapped("that is your answer rather than a choice to make again"));
      // A launcher that could not meet what was asked is reported to the person
      // once, in the first reply — a fact about the designation, not the turn.
      expect(body).toMatch(
        wrapped(
          "**A weight your launch reports it could not meet is stated once, in your first reply.**",
        ),
      );
      expect(body).toMatch(
        wrapped("is a fact about this whole designation rather than about one turn"),
      );
      expect(body).toMatch(wrapped("It is never repeated on a later answer"));
    });

    it("ends the run when the designation's weight changed, without a goodbye", () => {
      expect(body).toMatch(
        wrapped(
          "**A weight that changed on your row ends your run of it, and the designation stands.**",
        ),
      );
      expect(body).toMatch(
        wrapped(
          "somebody has asked for this conversation to be worked at a weight this session cannot become",
        ),
      );
      // The same ending as a release, reached one read later — and the same
      // three actions, in the same order.
      expect(body).toMatch(
        wrapped("Finish the turn you are in, settle everything you claimed, and exit"),
      );
      // But not the same sign-off: the lane is still designated, so the farewell
      // the release path posts would be false here.
      expect(body).toMatch(wrapped("Write no goodbye and claim nothing further"));
      expect(body).toMatch(wrapped("the conversation is not going back to the general agent"));
      expect(body).toMatch(wrapped("taken again from the roster as soon as you stop parking"));
    });
  });

  it("settles first-person, and only what it claimed", () => {
    expect(body).toMatch(/\*\*2\. You settle your own lane\.\*\*/);
    expect(body).toMatch(/Nobody settles work they did not claim/);
    expect(body).toMatch(/The orchestrator does not settle for you and you never settle for it/);
    for (const verb of ["corpus queue complete", "corpus queue fail", "corpus queue defer"]) {
      expect(body, `missing "${verb}"`).toContain(verb);
    }
    expect(body).toContain("--reason");
    expect(body).toContain("--blocked-on");
    // A deferral is lane-preserving and is not a failure.
    expect(body).toMatch(/\*\*Deferral keeps the lane\.\*\*/);
    expect(body).toMatch(/under `deferred` and\s+never `failed`/);
  });

  /**
   * AGENT-027 — the other half of AGENT-026's collision, and the same failure.
   *
   * AGENT-026's live drill measured it: a listener launched for a lapsed lane
   * parked, the lane went live, and its **first** scoped claim reported the
   * orchestrator's in-flight event in `inProgress`. This skill's reconciliation
   * then read the thread, found nothing answering the turn, did the work and
   * completed the orchestrator's event. Two agents answered one message and
   * nothing anywhere reported an error — both skills behaved exactly as written.
   *
   * AGENT-026 closed the path the orchestrator controls (*per lane, per pass,
   * take the work or launch the listener, never both*). It cannot close the
   * other two — a person re-designating a thread, or an operator running
   * `/converse` by hand, while the orchestrator holds that lane's work under the
   * fallback. This side has to decline it.
   *
   * **The signals do not distinguish the two cases at the row**, and that is
   * measured rather than assumed: `apps/server/src/queue/held.ts` filters the
   * held report by lane alone and the row carries `id`, `type`, `heldSince`,
   * `originId`, `originTitle` and no claimant; `corpus agents` prints the same
   * `summary` on every row and the contract forbids parsing it. So the skill
   * cannot classify a row from the server's answer, and it must not try. What it
   * can do is ask a first-person question — *did I claim this, in this session?*
   * — and that is exact for the case reconciliation exists for (its own dropped
   * settling call) while the cross-session case is recovered by `reap-stale`
   * instead, as a `pending/` row on the same lane. Declining therefore delays a
   * crashed listener's work; it never strands it.
   */
  describe("reconciliation adopts only what this listener claimed", () => {
    it("asks whose a row is before asking what the corpus says about it", () => {
      expect(body).toMatch(
        /\*\*A held row older than your first claim on this lane is not yours\.\*\*/,
      );
      expect(body).toMatch(/did I claim this event, in this session\?/);
      expect(body).toMatch(
        /On your \*\*first\*\* claim of a\s+session the answer is no for every row, necessarily/,
      );
      expect(body).toMatch(/`heldSince` is the same test in mechanical form/);
      // Order is the whole of it: the corpus-evidence test is what does the
      // damage, and it only does it when nothing has disqualified the row first.
      const ownership = body.indexOf("A held row older than your first claim on this lane");
      const evidence = body.indexOf("For a row you did claim in this session");
      expect(ownership, "the ownership test is missing").toBeGreaterThan(-1);
      expect(evidence, "the evidence test is missing").toBeGreaterThan(ownership);
    });

    it("keeps the evidence test, but only under the qualifier that makes it safe", () => {
      // The sentence that did the damage is still here — reconciliation needs
      // it — so what is pinned is the paragraph it now lives in. A rewrite that
      // lifts it back out to the top of the section restores the defect exactly.
      const damaging = "If nothing answers it, the work did not happen: do it now";
      const at = body.indexOf(damaging);
      expect(at, `"${damaging}" is missing`).toBeGreaterThan(-1);
      expect(body.indexOf(damaging, at + 1), "stated twice, once unqualified").toBe(-1);
      const paragraph = body.slice(0, at).split("\n\n").at(-1) ?? "";
      expect(paragraph, "the evidence test is stated unqualified").toContain(
        "For a row you did claim in this session",
      );
      // And the recognised half of it, which is the ordinary reason to reconcile.
      expect(body).toMatch(/settle it now with the ordinary verbs, log that it settled late/);
    });

    it("names the orchestrator's fallback as what it is usually looking at, and why", () => {
      expect(body).toMatch(
        /\*\*What you are usually looking at is the orchestrator, mid-dispatch\.\*\*/,
      );
      expect(body).toMatch(/a lane stamp is written once and\s+never rewritten/);
      // SERVER-111's reason for the wider filter. Without it a later editor
      // reads the row as a leak and "fixes" the server instead of obeying it.
      expect(body).toMatch(
        /reported on strict\s+lane equality instead, the list would hide from the orchestrator/,
      );
      // The two ways in that the orchestrator cannot prevent, named as ordinary.
      expect(body).toMatch(/re-designating this thread, or starting a listener by hand/);
    });

    it("says why the corpus cannot settle the question, which is how the defect arrived", () => {
      expect(body).toMatch(/\*\*A row that is not yours is left exactly where it is\.\*\*/);
      expect(body).toMatch(/above all do not do the work/);
      expect(body).toMatch(/\*\*The corpus cannot answer this question\s+for you\*\*/);
      expect(body).toMatch(/looks identical to an event nobody ever worked/);
      expect(body).toMatch(/in both cases no reply is posted yet/);
      // The consequence, stated as the thing it is: not a crash, a duplicate.
      expect(body).toMatch(/answered by two agents/);
      expect(body).toMatch(/with no error raised anywhere/);
    });

    it("keeps the recovery reconciliation exists for, by naming the path that carries it", () => {
      expect(body).toMatch(
        /\*\*Declining a row strands nothing, which is what makes declining safe\.\*\*/,
      );
      expect(body).toMatch(/crashed mid-event does get its work back/);
      expect(body).toMatch(/reconciliation was never that path/);
      expect(body).toMatch(/returns work nobody can account for to `pending\/`/);
      expect(body).toMatch(/\*\*the lane it was claimed from\*\*/);
      expect(body).toMatch(/an ordinary\s+row in `events` — to be worked, not adopted/);
      // The trade, so the delay reads as chosen rather than as a bug to fix.
      expect(body).toMatch(/a delayed answer costs the person a wait/);
      // And the one thing a long-held row actually indicates.
      expect(body).toMatch(/nothing is running the orchestrator's loop/);
    });

    it("parks before it claims, so the boundary the rule measures against stops moving", () => {
      expect(body).toMatch(/\*\*Park before you claim anything\.\*\*/);
      expect(body).toMatch(/parking is what makes the lane read `live`/);
      expect(body).toMatch(
        /Claiming first leaves a window in which the same conversation is being\s+handed to two places/,
      );
    });

    it("corrects the loop's own account of the held list", () => {
      // The sentence a rewrite restores: "It is your lane's held work and
      // nobody else's" was true about lanes and false about claimants, which is
      // the exact confusion the defect is made of.
      expect(body).not.toMatch(/your lane's held work\s+and nobody else's/);
      expect(body).toMatch(
        /It is your \*\*lane's\*\* held work, which is not the same thing as\s+your own/,
      );
      expect(body).toMatch(/it may be\s+holding work off this one, under the fallback/);
    });

    it("carries the rule to the two places a listener actually meets it", () => {
      // Arriving after a lapse — the section a returning resident reads.
      expect(body).toMatch(/\*\*Do not adopt what the orchestrator is still holding\.\*\*/);
      expect(body).toMatch(/nothing on the row to say it is\s+in flight/);
      expect(body).toMatch(/do not race the work it\s+is still doing/);
      // And the roster branch at startup, at the moment the state is read.
      expect(body).toMatch(/it may be \*\*holding some of it right now\*\*/);
      // The worked example must not contradict either: its empty held list is
      // annotated rather than left as the only case a reader ever sees.
      expect(body).toMatch(
        /had something been, this being the\s+session's first claim it would have been somebody else's/,
      );
    });
  });

  /**
   * AGENT-029 — the seam AGENT-026 and AGENT-027 each closed a hole beside.
   *
   * Presence is `observePark` and its one production call site is the idle
   * path, so a resident holds no park while it works — and this skill tells it
   * to work long turns unparked (*"You await what you launch; you do not park on
   * it"*). Measured against a real server: a listener claimed at 14:17:16 and
   * worked; at 14:33:16 its row read `lapsed` while the work was still running.
   * The orchestrator's launch rule fires on exactly that reading, neither of its
   * guards applies, and the second listener's own startup guard reads the same
   * `live: false` — so it parks, and one conversation has two listeners with no
   * error anywhere.
   *
   * The roster cannot be made to answer this here: the distinguishing signal is
   * `summary`, whose content the contract explicitly refuses to promise. So the
   * repair is at the lane rather than at anyone's knowledge, and what is pinned
   * is the instrument, because it is the part a rewrite cannot rederive — **an
   * empty `events` on work the park just named, with those ids in `inProgress`**.
   * Both halves are load-bearing: without the held check, a halt or an abandon
   * between the two commands retires the only listener on the lane.
   *
   * The claim's emptiness is decisive only because a live lane is invisible to
   * an unscoped claim (`queue/lanes.ts`), which is why the skill has to carry
   * that reason rather than the bare rule.
   */
  describe("a second listener finds out it is second, and goes", () => {
    it("says the roster can rule a listener in and never out", () => {
      expect(body).toMatch(/\*\*Neither says nobody is here, either\.\*\*/);
      expect(body).toMatch(
        /a listener in\s+the middle of a turn — which is where a resident spends most of its time — holds no park/,
      );
      expect(body).toMatch(/`live` is the only reading on this row with a\s+definite meaning/);
      expect(body).toMatch(
        /can tell you a listener \*\*is\*\* here and can never tell you one is\s+not/,
      );
      // And the forbidden shortcut: the one field that would answer it.
      expect(body).toMatch(/whose length is promised and whose content is not/);
    });

    /**
     * AGENT-031 — the rule AGENT-029 wrote was a conjunction, and its second
     * conjunct discarded the signal.
     *
     * *"an empty `events` array **and** those same ids sitting in its
     * `inProgress`"* holds only while nothing else arrives. The two claims are
     * two independent sessions each deciding to run a command — seconds apart —
     * and a person who has just posted M1 posting M2 is ordinary. The loser's
     * claim then returns `events: [M2]`, **non-empty**, the rule does not fire,
     * AGENT-027 tells it the winner's M1 in `inProgress` is "not yours", and it
     * works M2 and re-parks: two listeners answering alternate messages in one
     * conversation. Drilled with two live listeners and two messages (the case
     * AGENT-029's one-message drill could not reach) — measured on the real
     * server, the loser's claim came back `events:[M2]`, `inProgress:[M1]`.
     *
     * So the rule is restated on the peer-claim evidence **alone**, and the
     * emptiness clause is deleted rather than repaired: it never had a job of
     * its own. The look-alikes it was thought to guard are already excluded by
     * the held list — a halted queue leaves the id `pending/` and an abandon
     * moves it to `abandoned/`, so neither puts it in `inProgress` (both
     * measured).
     *
     * **Soundness, re-derived against the new predicate** rather than inherited.
     * The interval is unchanged — between this listener's park returning and its
     * own claim — so AGENT-029's argument still applies per id: `observePark`
     * stamps `lastSeen` on release as well as arrival (`queue/liveness.ts`), the
     * lane therefore reads live for a whole grace window after the park returns,
     * and `visibleTo` hides a live lane's events from an unscoped claim
     * (`queue/lanes.ts`); orchestrate never passes `--thread`. Two further
     * producers were checked and neither exists: nothing but a claim moves an
     * event `pending/` → `in-progress/`, and `inProgress` is the held list **as
     * it stood when the call arrived**, so a listener's own just-claimed ids can
     * never appear in it (published in `docs/cli.md`, and measured — a claim
     * that returned `events:[evt_…]` reported `inProgress: []`).
     */
    it("fires on the peer-claim evidence alone, with no emptiness conjunct", () => {
      // The AGENT-029 form, gone. Both matchers were run against the pre-fix
      // body first and both fire on it; neither fires on what replaced it.
      expect(body, "the conjunction is back").not.toMatch(
        /an empty `events` array \*\*and those same/,
      );
      expect(body, "the rule still leads on emptiness").not.toMatch(
        /An empty claim on work your park just named/,
      );
      expect(body).toMatch(
        /\*\*An id your park named, held by somebody else when you claim, means another listener is on\s+this lane\.\*\*/,
      );
      // The two lists, and what makes reading one against the other exact.
      // AGENT-049: the park's bare output is one line per pending event, not a
      // JSON `events` list — the pin follows the corrected wording.
      expect(body).toMatch(/names what is \*\*pending\*\* on your lane, one line per event/);
      expect(body).toMatch(/never includes what that same call has just claimed for you/);
      expect(body).toMatch(
        /coming back in `inProgress` instead of in your `events`, was\s+claimed by another caller/,
      );
      expect(body).toMatch(/\*\*One such id is the whole of the evidence\. Exit\.\*\*/);
      // Why the orchestrator is not a candidate — the half a reader cannot
      // rederive, and the half the whole rule rests on.
      expect(body).toMatch(
        /your park released moments ago, the lane\s+therefore reads live for the whole grace window that follows, and an unscoped claim never sees\s+a live lane's events/,
      );
      // Structural: the firing sentence must not condition on emptiness at all.
      // A rewrite that re-adds "and the events array is empty" lands in this
      // paragraph, where the word is what the whole issue is about.
      const firing = body
        .split("\n\n")
        .find((paragraph) => paragraph.includes("held by somebody else when you claim"));
      expect(firing, "the firing paragraph is missing").toBeDefined();
      expect(firing ?? "", "the firing rule mentions emptiness again").not.toMatch(/empt/i);
    });

    it("says a second message does not suppress it, which is how it shipped", () => {
      expect(body).toMatch(/\*\*Judge it on that id, and never on the claim being empty\.\*\*/);
      expect(body).toMatch(
        /a person who has just written one\s+message writing a second is the ordinary case, not a rare one/,
      );
      expect(body).toMatch(/so your `events` comes back \*\*non-empty\*\*/);
      // The exact failure the conjunction produced, named as what it is.
      expect(body).toMatch(/the peer's held row reads as merely \*not yours\*/);
      expect(body).toMatch(
        /Two agents, one\s+conversation, alternate messages, neither able to see what the other said/,
      );
      expect(body).toMatch(/present in exactly the same way whether the batch was empty or not/);
    });

    it("hands back what the losing claim took, rather than claiming nothing was stranded", () => {
      // AGENT-029 could say "you were not in the middle of anything" because its
      // rule only fired on an empty batch. This one fires on a batch that may
      // hold a real message, so the disposal has to be stated.
      expect(body, "still asserts the loser holds nothing").not.toMatch(
        /You lost the message, so you were not\s+in the middle of anything and nothing is stranded/,
      );
      expect(body).toMatch(/\*\*Go without finishing what that claim handed you\.\*\*/);
      expect(body).toMatch(/Do not work it, do not settle it, do not\s+reply to it/);
      expect(body).toMatch(/returns it to `pending\/` \*\*on the lane it was claimed from\*\*/);
      expect(body).toMatch(/the listener that stays claims it as an ordinary row/);
      expect(body).toMatch(/A late answer costs the person a wait/);
      // Post nothing to the thread — but the job log is now reachable, and it is
      // the only account of why the event sat.
      expect(body).toMatch(/Post nothing to the thread/);
      expect(body).toMatch(/`corpus job log` one line on each/);
      expect(body).toMatch(/Where it handed you none, there is nothing to log to/);
    });

    /**
     * Found by the two-listener drill, in the text written for this issue: the
     * **surviving** listener stood down too, on a row it had not claimed and its
     * park had never named ("standing down: evt_kirfeh2iis7w on this lane is
     * held by another caller"), and the conversation was left with no listener
     * at all. The peer test therefore has to carry its exclusions where it is
     * stated, or it collapses into "a held row I did not claim" — which is
     * AGENT-027's ordinary orchestrator-mid-dispatch row.
     */
    it("excludes the two held rows that are not a peer, and says what reading them costs", () => {
      expect(body).toMatch(/\*\*Two other held rows look like it and are neither\*\*/);
      expect(body).toMatch(
        /costs\s+the conversation the listener it really had — where both of you do it, it costs the\s+conversation both/,
      );
      // Not named by your park: the fallback's row, not a peer's.
      expect(body).toMatch(/A row \*\*your own park did not name\*\*/);
      expect(body).toMatch(/most often the orchestrator mid-dispatch/);
      // Claimed by you: yours however often it comes back.
      expect(body).toMatch(/And a row \*\*you claimed yourself in this session\*\* is yours/);
      expect(body).toMatch(/so any later claim reports\s+it to you/);
      expect(body).toMatch(/did I claim this event, in\s+this session\?/);
      // And the scope of the test: the claim after the park, no other call.
      expect(body).toMatch(
        /this test belongs to the\s+claim that follows your park and to no other call/,
      );
      expect(body).toMatch(
        /a claim made in the middle of a pass is\s+looking at work you are holding yourself/,
      );
    });

    it("keeps the two look-alikes that must loop instead of exiting", () => {
      expect(body).toMatch(/\*\*Two quiet claims look like it and are not\*\*/);
      expect(body).toMatch(/comes back in \*\*neither\*\* list/);
      expect(body).toMatch(/the operator\s+halted the queue, or somebody abandoned the event/);
      expect(body).toMatch(/named no\s+work at all/);
      // And emptiness is denied a meaning in both directions, so neither the
      // deleted conjunct nor its inverse can be read back in.
      expect(body).toMatch(/\*\*An empty `events` is not the signal in either direction\*\*/);
      expect(body).toMatch(/only the held id tells\s+those apart/);
    });

    it("tells the reconciliation section what one of its not-yours rows means", () => {
      // Read from that side, the peer's row is just "older than my first claim,
      // leave it" — which is right about the row and silent about staying.
      expect(body).toMatch(/One kind of not-yours row says more than\s+\*leave it\*/);
      expect(body).toMatch(/where its id is one your own park named as\s+pending/);
      expect(body).toMatch(/Leaving the row is right either way; staying is not/);
    });

    /**
     * AGENT-032. The worked example annotated its empty held list with AGENT-027's
     * answer alone — *"it would have been somebody else's and left where it was"* —
     * in the one scenario this whole family is about: a listener's first park and
     * first claim. Not wrong, and understated in exactly the paragraph shape whose
     * first draft stood the surviving listener down in AGENT-031's drill. An
     * example that gives one of two answers is read as giving the answer.
     */
    it("gives the worked example's first claim both of its answers", () => {
      const example = body.slice(body.indexOf("## Worked example"));
      expect(example).toMatch(
        /had something been, this being the\s+session's first claim it would have been somebody else's and left where it was/,
      );
      expect(example).toMatch(/this example is exactly the case it turns on:\s+a first park/);
      // The counterfactual is written on the example's own ids, so it is read
      // against a payload the reader has just seen rather than in the abstract.
      expect(example).toMatch(
        /Had the held row been `evt_7c1d9a` itself — the id\s+this park had just named as pending/,
      );
      expect(example).toMatch(
        /the answer would have been to exit\s+here, having posted nothing and worked nothing/,
      );
      expect(example).toMatch(/Both\s+answers belong to this same moment, so read them together/);
    });

    it("says why the check belongs at the claim and forbids every earlier probe", () => {
      expect(body).toMatch(/\*\*Two parked listeners cost nothing until a message arrives\*\*/);
      expect(body).toMatch(/before the person has been answered twice or in two\s+voices/);
      expect(body).toMatch(/there is no probe for this/);
      expect(body).toMatch(/a shortened park to "check" is the keep-alive this skill forbids/);
      // The tie-break is deliberately not arbitrated, and the reason it can be.
      expect(body).toMatch(/Which of you loses the race is not worth arbitrating/);
    });

    it("names a long turn as the cause, without proposing a way to look present", () => {
      expect(body).toMatch(
        /\*\*Your own long turn lapses your own lane, and that is the design rather than a slip\.\*\*/,
      );
      expect(body).toMatch(
        /the orchestrator may then launch a listener\s+into a lane you are sitting in/,
      );
      expect(body).toMatch(/It cannot tell the difference and it is right not to guess/);
      // The three repairs a reader would otherwise invent, refused by name.
      expect(body).toMatch(
        /do not shorten the turn, do not break it up to re-park in the\s+middle, and do not park while you are holding work/,
      );
    });
  });

  it("orders the settling call after the writes, with the exit that proves it", () => {
    // Measured against a running server: `--job` naming a settled event is
    // exit 5, so settling early does not fail — it makes the rest of this
    // agent's own work unfileable, which is the silent half.
    expect(body).toMatch(/\*\*Settle last, after every write the event served\.\*\*/);
    expect(body).toMatch(/refused at exit `5`/);
    expect(body).toMatch(/settled work cannot acquire a scope/);
    expect(body).toMatch(/silently makes the rest of your own work unfileable/);
    // And the provenance loop the ordering exists for.
    expect(body).toContain("export CORPUS_JOB=evt_7c1d9a");
    expect(body).toContain("--job <evt_…>");
    expect(body).toMatch(/\*\*Omitting it is free\.\*\*/);
    expect(body).toMatch(/\*\*Misnaming it is not\.\*\*/);
    expect(body).toMatch(/`corpus doc detach` is user-only/);
  });

  it("makes presence the parked request and forbids every substitute for it", () => {
    expect(body).toMatch(
      /\*\*You are present because you are parked, and for no other reason\.\*\*/,
    );
    expect(body).toMatch(/nothing\s+to register, no heartbeat to send/);
    expect(body).toMatch(/\*\*Never write a\s+keep-alive\*\*/);
    expect(body).toMatch(/no announcement turn, no periodic ping, no shortened park/);
    // The startup read is ordered against the park, which is what gives it meaning.
    expect(body).toMatch(/\*\*The ordering is what makes this check mean anything\.\*\*/);
    expect(body).toMatch(/after you park, `live` on your row is you/);
    expect(body).toMatch(/\*\*One consumer per lane, and that includes you\.\*\*/);
    expect(body).toMatch(/split the conversation's story in half/);
    // And no arrival turn, which is the keep-alive's polite cousin.
    expect(body).toMatch(/\*\*Say nothing yet\.\*\*/);
  });

  it("treats a lapse as the design working, and restates no window", () => {
    expect(body).toMatch(/\*\*Do not treat a `lapsed` row as breakage\.\*\*/);
    expect(body).toMatch(/\*\*Do not redo what the orchestrator did while you were gone\.\*\*/);
    expect(body).toMatch(
      /slower, and without\s+this conversation's warmth, but never silently not done/,
    );
    expect(body).toMatch(/\*\*Do not shorten your park to lapse less\.\*\*/);
    expect(body).toMatch(/longer than a\s+rearm gap/);
    // The number is the server's, and naming it here is how the two drift apart.
    expect(body).toMatch(/that\s+number is the server's and this skill does not restate it/);
    for (const restatement of ["16m", "16 minutes", "960"]) {
      expect(body, `restates the grace window as "${restatement}"`).not.toContain(restatement);
    }
  });

  it("describes scope as the walk it is, never as a guarantee of exclusivity", () => {
    // SHARED-044: §7's "an artifact belongs to at most one scope" is not
    // delivered by its own clauses, and the CLI's help deliberately describes
    // the walk instead. This text does the same — a resident told it owns its
    // scope exclusively would act on an inventory the server never promised.
    expect(body).toMatch(/\*\*Scope membership is\s+a walk, not a label\*\*/);
    expect(body).toMatch(/follows\s+a thread's parents and a document's `origin`/);
    expect(body).toMatch(
      /\*\*Reason from the lane, never from your own idea of what belongs to you\.\*\*/,
    );
    expect(body).toMatch(/Do not build a mental\s+inventory/);
    expect(body).not.toMatch(/belongs to at most one scope/);
    expect(body).not.toMatch(/exclusively yours/);
    // The stamp is made once, which is why designating moves nothing.
    expect(body).toMatch(/\*\*The stamp is made once and never rewritten\.\*\*/);
    expect(body).toMatch(/\*\*You never see the designation event\.\*\*/);
  });

  it("answers a summons where it was asked, and annexes nothing", () => {
    expect(body).toMatch(/\*\*Reply where the event's payload says\.\*\*/);
    expect(body).toMatch(/no walk, no\s+classification/);
    expect(body).toMatch(/Routing follows the recipient;\s+filing follows the conversation/);
    expect(body).toMatch(/\*\*An override never rewires anything\*\*/);
    expect(body).toMatch(/do not adopt its documents into this conversation/);
  });

  it("delegates a side task under the orchestrator's rules, and awaits it", () => {
    expect(body).toMatch(/\*\*You await what you launch; you do not park on it\.\*\*/);
    // The reason the two skills diverge here, so the choice reads as a decision.
    expect(body).toMatch(
      /Nothing of yours is behind this\s+work except the next message in this one conversation/,
    );
    expect(body).toMatch(/one piece of work with\s+one status and one reply/);
    // The boundary a dispatch may never cross, which is what a second claimant is.
    expect(body).toMatch(/never runs a claim, a park, or a terminal call/);
    expect(body).toMatch(/A subagent that inherits a lane is a\s+second claimant/);
  });

  it("binds the reply grammar by reference rather than restating it", () => {
    // The comment skill is the manual for a turn; three copies of one doctrine
    // is three things to keep in step, and the issue asked for one.
    expect(body).toMatch(/The \*\*comment\*\* skill is your working manual for a turn/);
    expect(body).toMatch(/none of it is repeated here/);
    // Including the one sentence in it that is written for the other lane.
    expect(body).toMatch(/the terminal call on the event belongs to the\s+orchestrate skill alone/);
    expect(body).toMatch(/written for a subagent working on the orchestrator's lane/);
    // The weight table is declared in exactly one file, and this is not it.
    expect(body).toMatch(/do not restate the table here/);
    expect(readWeightLevels(body)).toEqual([]);
  });

  it("ends the designation on a roster read, because nothing else will", () => {
    expect(body).toMatch(/\*\*neither of them sends you an event\*\*/);
    // A sign-off on an open thread, nothing on a resolved one.
    expect(body).toMatch(/\*\*If it is resolved, post nothing\*\*/);
    expect(body).toMatch(/Reopening a resolved thread later does not bring you back/);
    // Measured in the live drill: a release landed while the listener was
    // parked and was read at the top of the next pass, one rearm later. That
    // latency is stated as correct so it does not get "fixed" with a poll.
    expect(body).toMatch(/\*\*Finding out one rearm late is correct, not a gap\.\*\*/);
    expect(body).toMatch(/every message written in between was\s+stamped for the orchestrator/);
  });

  /**
   * PR #50, MINOR 6. An example belongs to whatever step it follows. The
   * sign-off block had drifted below *If it is resolved, post nothing*, so the
   * one instruction adjacent to a `corpus thread reply` was the instruction not
   * to post — fallout from AGENT-035 lifting an indented terminator to column
   * zero, which is a fence-placement change nothing was watching. The fix is
   * ordering, not indentation: the terminator stays at column zero (an indented
   * one closes nothing) and the block moves up under the step that sends it.
   */
  it("puts the sign-off block under the step that sends it", () => {
    const signOff = body.indexOf("If it is still open, sign off once");
    const postNothing = body.indexOf("If it is resolved, post nothing");
    const replyBlock = body.indexOf("corpus thread reply th_4b8e2c --from agent", signOff);
    expect(signOff, "the sign-off step is gone").toBeGreaterThan(-1);
    expect(postNothing, "the post-nothing step is gone").toBeGreaterThan(-1);
    expect(replyBlock, "the sign-off step shows no reply").toBeGreaterThan(-1);
    expect(replyBlock, "the sign-off example follows the step that forbids posting").toBeLessThan(
      postNothing,
    );
    // And the step points at it, so the two are read together rather than the
    // reader inferring the block from proximity alone.
    expect(body).toMatch(/the reply is the block\s+directly below/);
    // The negative step says which reply it is withholding, since it now has
    // one above it rather than below.
    expect(body).toMatch(/post nothing\*\* — not the reply above/);
  });

  /**
   * AGENT-040, the converse half. The orchestrate skill now launches a
   * successor onto a lane whose release this session processed, while the
   * outgoing listener may still hold its park — so the successor's own startup
   * read finds `live`, and the old unconditional branch ("a listener already
   * holds this lane. Exit") would have the successor kill itself and hand the
   * lane back to a leaver. Without this branch, the orchestrate fix launches
   * listeners that immediately stand down, which is the same decorative
   * instruction AGENT-041 was filed about. The launch prompt is the carrier:
   * orchestrate says a release-following launch states that it is one, and this
   * branch reads it.
   */
  describe("a launch that follows a release parks through a live row", () => {
    it("branches the startup live reading on what the launch said", () => {
      // The exception, and what that `live` is.
      expect(body).toMatch(/\*\*Where your launch says it follows a\s+release, park anyway\*\*/);
      expect(body).toMatch(/that `live` is the listener you are replacing/);
      expect(body).toMatch(
        /its designation is gone, so it is leaving whether or\s+not it knows yet/,
      );
      // Which of the two stays is settled where duplicates are always settled —
      // the contested claim converse already owns — not by a new mechanism.
      expect(body).toMatch(
        /The first contested claim \(\*The loop\*\) is what settles which of you\s+stays/,
      );
      // The default is unchanged: no release named, a live lane is answered.
      expect(body).toMatch(
        /\*\*Where your launch says nothing\s+about a release, exit without claiming anything and log why\*\*/,
      );
    });

    it("tells a sitting resident a successor can arrive, without restating the launch rule", () => {
      // The old sentence taught the pre-AGENT-040 orchestrator: re-designating
      // a held lane "launches nothing new". It launches a successor now.
      expect(body, "the pre-AGENT-040 account is back").not.toMatch(/launches nothing\s+new/);
      expect(body).toMatch(/\*\*replaces\*\* the designation you were launched for/);
      expect(body).toMatch(/a new listener may be launched\s+while you still hold your park/);
      // Single-owner: the launch rule stays orchestrate's; converse carries the
      // outcome and its own two ways of finding out.
      expect(body).toMatch(/Whether one is launched is the orchestrate skill's rule/);
      expect(body).toMatch(
        /a\s+changed weight on your row \(\*Retirement\*\), or the first contested claim \(\*The loop\*\)/,
      );
      expect(body).toMatch(/until then you work on/);
    });
  });

  /**
   * AGENT-030 — SERVER-118 changed what a scoped park does, and this text was
   * not swept. It taught that a park on an undesignated lane *"is accepted and
   * parks; it does not error"*, so a resident whose designation ended between
   * its roster read and its park had **no instruction at all** for what the
   * server now answers.
   *
   * Measured on a real server (`corpus init` workspace, port 8791, real
   * release, real CLI):
   *
   * ```
   * $ corpus queue idle --thread th_nd4kdqxa            # lane just released
   * corpus: 422 unknown_recipient: `th_nd4kdqxa` names no lane to consume: …
   * EXIT=5
   * $ corpus queue claim-all --thread th_nd4kdqxa       # same lane, same instant
   * {"events":[{"id":"evt_lov4jqy6lamp",…}],"inProgress":{"events":[],"total":0}}
   * EXIT=0
   * ```
   *
   * Three things are therefore pinned, and each has a silent failure behind it:
   *
   * - **The refusal is an ending, not a crash.** With no instruction the shell
   *   exits 5 mid-loop: the event the listener holds stays in `in-progress/`
   *   (reproduced — `evt_dky2cuikw2cs` sat there) and the sign-off the skill
   *   requires is never posted.
   * - **The code, not the exit status, is the signal.** Exit 5 is every server
   *   error; a park that fails because the server is down is exit 4. Retiring on
   *   either would abandon a conversation this listener still owns.
   * - **`claim-all` is deliberately unguarded** (SERVER-118's own decision), so
   *   the departing listener can drain what was stamped for the lane before the
   *   release — invisible to the orchestrator's unscoped claim until the lane
   *   lapses.
   */
  describe("a refused park is retirement, not death at the shell", () => {
    it("states what the server now does, and no longer what it used to", () => {
      // The three falsified clauses. Each ran against the pre-fix body first:
      // "accepted and parks; it does not error, because a lane may be designated
      // a moment later … So a listener that skips the check waits forever on a
      // conversation that no longer has it" — all three matchers fire on that
      // sentence and none fires on the text that replaced it.
      expect(body, "the park is said to be accepted").not.toMatch(/accepted and parks/);
      expect(body, "the park is said not to error").not.toMatch(/it does not error/);
      // Both spellings: the rule said "waits forever" and the worked example
      // said "waiting forever", and a matcher for one leaves the other free to
      // come back.
      expect(body, "the old failure mode is back").not.toMatch(/wait(?:s|ing) forever/);
      // What it does instead, with the code that says which refusal it is.
      expect(body).toMatch(/\*\*A refused park is the same ending, found one step later\.\*\*/);
      expect(body).toMatch(/is refused, not accepted, and nothing is parked/);
      expect(body).toMatch(/`th_4b8e2c` names no lane to consume/);
    });

    it("sends the listener into retirement rather than out of the shell", () => {
      expect(body).toMatch(/\*\*Retire on it; do not die on it\.\*\*/);
      // The consequence of the missing instruction, named as what it is.
      expect(body).toMatch(/exits at the shell/);
      expect(body).toMatch(/holding its last event/);
      expect(body).toMatch(/owing the conversation a goodbye nobody posts/);
      expect(body).toMatch(/run the steps below from the first/);
      // And the steps are entered from either discovery, not only the roster.
      expect(body).toMatch(/When your row is gone from the roster, or your park was refused:/);
    });

    it("refuses to retire on any other failure, and says which is which", () => {
      expect(body).toMatch(/\*\*It is that refusal and no other failure\.\*\*/);
      expect(body).toMatch(/The signal is the code and never the exit\s+status/);
      expect(body).toMatch(/`unknown_recipient`/);
      expect(body).toMatch(/carries as `error\.code`/);
      // The two neighbours it must not be confused with, by exit code.
      expect(body).toMatch(/the server being unreachable is exit `4`/);
      expect(body).toMatch(/another server error is exit\s+`5` with a different code/);
      expect(body).toMatch(/walks out on a conversation you\s+still hold/);
      expect(body).toMatch(/Park again instead/);
    });

    it("carries the other verb too, with the reason the two differ", () => {
      expect(body).toMatch(/\*\*The claim is not refused, and the asymmetry is deliberate\.\*\*/);
      expect(body).toMatch(
        /still answers on a lane whose resident was just\s+released, and hands back/,
      );
      // Why refusing it too would be worse: nobody could reach those events.
      expect(body).toMatch(
        /the orchestrator's unscoped claim cannot see this lane\s+until it has lapsed out of presence/,
      );
      expect(body).toMatch(/strand them for a whole grace\s+window/);
      // So the drain is an instruction, not a fact about the server.
      expect(body).toMatch(/Draining them is therefore the departing listener's job/);
      expect(body).toMatch(/make \*\*one\*\* last/);
      // The live drill claimed twice — drain, work, then "one last drain claim"
      // to check — so the bound needs its reason attached, not just the word.
      expect(body).toMatch(/\*\*One claim is provably enough\*\*, so do not claim again to check/);
      expect(body).toMatch(/a second claim can only ever come back empty/);
      expect(body).toMatch(/park at no point in any of this/);
    });

    it("answers the same refusal at startup, where there is nothing to settle", () => {
      expect(body).toMatch(/\*\*A park refused here is step 2's missing row, one step later\.\*\*/);
      expect(body).toMatch(/You are\s+holding nothing and you have said nothing/);
      expect(body).toMatch(/say so and exit, exactly as you would have for a row that was not/);
    });

    it("leaves no worked example or loop note contradicting the refusal", () => {
      // AGENT-019's shape: an example beats the rule it contradicts. The old
      // example closed on "parking on it would be waiting forever", which the
      // `waits forever` matcher above also covers; this pins the replacement.
      expect(body).toMatch(/would come straight back\s+`422 unknown_recipient`/);
      // And the loop's own account of the verb's exit codes, which said 0 always.
      expect(body, "the loop still promises exit 0 unconditionally").not.toMatch(
        /`corpus queue idle` exits `0` in every normal case\. /,
      );
      expect(body).toMatch(
        /exits `0` in every normal case but one, and that one is an ending rather\s+than an error/,
      );
      // The departing drain is shown as well as stated, on the lane it belongs to.
      const retirementClaims = fencedBlocks(body)
        .filter((block) => block.info === "bash")
        .flatMap((block) =>
          extractCorpusInvocationUses(["```bash", block.content, "```"].join("\n")),
        )
        .filter(({ tokens }) => tokens[0] === "queue" && tokens[1] === "claim-all");
      expect(retirementClaims.length, "no worked claim to check").toBeGreaterThan(1);
      for (const use of retirementClaims) expect(use.flags).toContain("--thread");
    });

    /**
     * AGENT-032, the fourth producer of the stand-down signal — and the only one
     * that is not a peer listener. AGENT-030 gave a retiring listener a drain
     * claim; a person may re-designate the same thread (which this skill already
     * contemplates in *Settling your own lane*). Interleave the two: release →
     * A's park refused → the thread is designated again → the orchestrator
     * launches B → B parks and its park names E as pending → A's **drain** claim
     * takes E. B then sees E held, its own park named it, and it did not claim
     * it — all three exclusions pass, B exits, A is leaving, and the
     * conversation has no listener.
     *
     * It cannot be excluded at B: the held row carries no claimant and never
     * will (`apps/server/src/queue/held.ts`), so B cannot tell a retiring
     * listener's hold from a peer's. So it is closed at the producer — the drain
     * is conditional on a roster read taken immediately before it, and a row
     * that is back is a designation belonging to somebody else. The residual
     * race (a designation landing between that read and that claim) needs B's
     * whole launch and startup to fit inside two consecutive commands, and its
     * cost is a lane with no resident, which the orchestrator's fallback covers.
     */
    it("does not drain a lane that has been designated again", () => {
      expect(body).toMatch(
        /\*\*Unless the conversation has been designated again — and then the drain is not yours to\s+make\.\*\*/,
      );
      // Why the paragraph above it no longer settles the question on its own.
      expect(body).toMatch(/the argument above\s+turns over on its own premise/);
      expect(body).toMatch(/they are the\s+successor's ordinary pending work/);
      // What it costs, in the successor's own terms — this is the part a
      // rewrite cannot rederive, and the reason the drain is not merely rude.
      expect(body).toMatch(
        /the row says nothing about who holds it or that they are leaving, so it\s+cannot read your departure as anything but a peer/,
      );
      expect(body).toMatch(/evict the healthy\s+listener that replaced you/);
      // The instrument, and its ordering — a roster read minutes old is no test.
      expect(body).toMatch(/\*\*read the roster immediately before you drain\*\*/);
      expect(body).toMatch(/a designation that is not yours/);
      expect(body).toMatch(/\*\*A row that is back ends this list here\*\*/);
      expect(body).toMatch(/post nothing,\s+drain nothing, and exit/);
      expect(body).toMatch(
        /`corpus agents` immediately before the claim rather\s+than minutes earlier/,
      );
      // And the worked example agrees rather than showing the unguarded drain.
      expect(body).toMatch(/The row is gone rather than back — nobody was designated in our place/);
    });
  });

  /**
   * Both found by a real Claude Code session driven by this text alone
   * (AGENT-025's drill), and both are the AGENT-019 failure shape: a worked
   * example beats the rule that contradicts it.
   *
   * The session copied `--model claude-sonnet-4-5` out of the example onto its
   * first real turn, which is the one field in the whole product that exists to
   * be checkable — a copied one is false while looking exactly right. And the
   * example printed a `key` line after `corpus doc create`, which that verb does
   * not print (measured: `created doc_… — data/docs/…`, no key), leaving the
   * session unsure how to edit what it had just made.
   */
  it("marks the two things in its worked example that are not text to reuse", () => {
    expect(body).toMatch(
      /is what ran in this example; on your turn the name is what is running as you/,
    );
    expect(body).toMatch(
      /copying the string out of an example is the one way to make the field say\s+something false/,
    );
    expect(body).toMatch(/\*\*a create prints its id and its path, not a\s+key\*\*/);
    expect(body).toMatch(/`corpus doc show <id>` first and present what it printed/);
    // And the example itself must not contradict that: no key line after a create.
    for (const block of fencedBlocks(body).filter((fence) => fence.info === "bash")) {
      const lines = block.content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line.trimStart().startsWith("created doc_")) continue;
        expect(lines[index + 1] ?? "", "a create followed by a key it does not print").not.toMatch(
          /^key [0-9a-f]{64}$/,
        );
      }
    }
  });

  it("hands a successor the corpus, never a transcript", () => {
    expect(body).toMatch(/A degraded listener holding a lane is worse\s+than no listener at all/);
    expect(body).toMatch(/presence is what keeps the fallback from firing/);
    expect(body).toMatch(/\*\*Do not park again\.\*\*/);
    expect(body).toMatch(/There is no transcript handoff and you must not attempt one/);
    expect(body).toMatch(/The thread and its artifacts are the memory/);
    // Which is what makes stewardship machinery rather than good manners here.
    expect(body).toMatch(/\*\*Stewardship is how you remember\.\*\*/);
  });

  it("runs the loop as discrete steps and never chains the claim to the park", () => {
    expect(body).toMatch(/\*\*This is a procedure, not a script\.\*\*/);
    expect(body).toMatch(/\*\*never chained\*\*/);
    expect(body).toMatch(/answered by\s+nobody, with no error anywhere/);
    // No fenced block may exist that a reader could paste as the whole loop.
    for (const block of fencedBlocks(body).filter((fence) => fence.info === "bash")) {
      const lines = block.content.split("\n").map((line) => line.trim());
      const claims = lines.some((line) => line.startsWith("corpus queue claim-all"));
      const parks = lines.some((line) => line.startsWith("corpus queue idle"));
      expect(claims && parks, "a block a reader could copy as the whole loop").toBe(false);
    }
    expect(body.match(/\bsleep\b/gi) ?? []).toHaveLength(1);
    expect(body).not.toContain("while true");
    // Work in one lane is one conversation, so it is worked serially — and in
    // the conversation's order, which AGENT-038 measured is not the batch's.
    expect(body).toMatch(/one at a time, in the order the conversation has them/);
    expect(body).toMatch(/There is no overlap set to compute here/);
    // Halted is quiet, not an exit — and the strings are the ones the bare
    // command prints (AGENT-049), not the `--json` shape no example asks for.
    expect(body).toContain("idle — no events (halted)");
    expect(body).toContain("idle — no events (timeout)");
    expect(body).not.toContain('"idle":true');
  });

  it("hedges nothing and quotes every multi-line argument", () => {
    for (const hedge of [
      "use your judgment",
      "consider whether",
      "you may want",
      "if appropriate",
    ]) {
      expect(body.toLowerCase(), `hedges with "${hedge}"`).not.toContain(hedge);
    }
    const heredocs = body.match(/<<-?\s*\S+/g) ?? [];
    expect(heredocs.length).toBeGreaterThan(0);
    for (const heredoc of heredocs) expect(heredoc).toMatch(/^<<'CORPUS_EOF'$/);
  });
});

/**
 * AGENT-033 — SPEC.md §7's SHARED-048 rider, in the two skills that assumed a
 * designation always named a profile.
 *
 * A `Resident` is two nullable fields and therefore **three** states, all three
 * measured against a real server (throwaway workspace, port 8844, 2026-08-17):
 *
 * ```
 * $ corpus thread designate th_agzzrvir --from user
 * designated a general resident on th_agzzrvir
 * $ corpus queue claim-all
 * … "payload":{"threadId":"th_agzzrvir","resident":{"name":null,"docId":null}} …
 * $ corpus agents
 * th_agzzrvir "Q3 planning" · a general resident · waiting for a listener
 * th_yqbho7rg "Refinance"  · researcher (doc_z4jbjkvk) · waiting for a listener
 * $ rm .claude/agents/researcher.md && corpus agents      # the profile goes
 * th_yqbho7rg "Refinance"  · researcher (profile missing) · waiting for a listener
 * ```
 *
 * What is pinned is the shape of the repair, in the three places it decays:
 *
 * - **Three readings, not two.** `name: null` (nobody asked for a persona) and
 *   `name` set with `docId: null` (one was asked for and is gone) are opposite
 *   facts about the same pair of fields, and only the second is worth a line in
 *   a reply. Collapsed, a listener either apologises for working normally or
 *   swallows a designation whose subject has disappeared.
 * - **The ordinary case reads first**, because a rule written as an exception
 *   gets executed as one.
 * - **No placeholder at the launch.** The orchestrator forwards the two fields
 *   as they came. The contract says the same thing at `ResidentSchema.name` —
 *   do not substitute a word for null and print it as a name — and here the
 *   cost is concrete: an invented word reaches the listener as the name of a
 *   document nobody wrote.
 */
describe("a resident with no persona to bind", () => {
  const converse = documentAt("claude/skills/converse/SKILL.md").body;
  const orchestrate = documentAt("claude/skills/orchestrate/SKILL.md").body;

  /** The `## Starting up` step that reads the launch's `resident`, and only it. */
  const binding = converse.slice(
    converse.indexOf("**Bind a persona"),
    converse.indexOf("4. **Hydrate"),
  );

  /** The launch bullet in `## Routing`, and only it. */
  const launch = orchestrate.slice(
    orchestrate.indexOf("- **Launching a listener.**"),
    orchestrate.indexOf("- **Losing a listener.**"),
  );

  it("binds under one condition, with the profile-less reading first", () => {
    expect(binding, "the binding step is missing").not.toBe("");
    expect(binding).toMatch(/\*\*Bind a persona, if the designation named one\.\*\*/);
    // One rule over one pair of fields, never two parallel procedures.
    expect(binding).toMatch(/two fields, `name` and `docId`, read together/);
    const readings = [
      "**`name` is null.**",
      "**`name` and `docId` are both set.**",
      "**`name` is set and `docId` is null**",
    ].map((label) => binding.indexOf(label));
    expect(readings, "a reading is missing").not.toContain(-1);
    expect([...readings].sort((left, right) => left - right)).toEqual(readings);
    // And it is named as the ordinary one where it is read, not defended later.
    expect(binding).toMatch(/Most designations name no\s+profile at all/);
    expect(binding).toMatch(/\*\*general resident\*\*/);
  });

  /**
   * The drill's third case, and the one a rewrite loses first: a payload names
   * what resolved **when the designation was made** and nothing re-resolves it,
   * so a profile removed afterwards arrives with both fields set and 404s on the
   * read. Measured on the real server — `corpus doc show doc_gaefzfoh` on a
   * removed agent-def is `404 not_found`, exit `5`, while the roster and
   * `corpus thread show` already read `auditor (profile missing)`.
   */
  it("routes a payload whose document has gone into the missing reading", () => {
    expect(binding).toMatch(
      /\*\*Where that read comes back `404 not_found` at exit `5`, you\s+are in the reading below rather than this one\.\*\*/,
    );
    expect(binding).toMatch(/nothing re-resolves it afterwards/);
    expect(binding).toMatch(/arrives looking present and is not/);
    // Neither of the two wrong answers: a retry, or a report that the launch failed.
    expect(binding).toMatch(/Do not retry the read, and do not report the\s+launch as broken/);
    // And the reading it routes into admits both entrances.
    expect(binding).toMatch(
      /\*\*`name` is set and `docId` is null\*\*, or the read above found nothing/,
    );
  });

  it("keeps 'no profile' and 'a profile that has gone' apart, with their costs", () => {
    // Silence for the ordinary case…
    expect(binding).toMatch(/Say nothing about it, here or in any later turn/);
    expect(binding).toMatch(/an apology for working normally/);
    // …and exactly one line for the one a person can act on.
    expect(binding).toMatch(/\*\*Work anyway\*\*/);
    expect(binding).toMatch(/say so\s+\*\*once\*\*, in your first reply, naming what was named/);
    expect(binding).toMatch(
      /\*\*The first and the last are not the same fact and must not be told alike\.\*\*/,
    );
    expect(binding).toMatch(/What separates them is `name` alone/);
    // The pre-AGENT-033 sentence, which read as though a designation always
    // named a profile and left the ordinary case with no instruction at all.
    expect(converse, "the unconditional persona read is back").not.toMatch(
      /The designation names an agent/,
    );
  });

  it("resolves a hand-started listener's designation from the corpus", () => {
    // `/converse th_…` run by an operator carries no payload, which is the one
    // way to reach this step with nothing in hand.
    expect(binding).toMatch(
      /\*\*Started by hand there is no payload, and the corpus answers anyway\.\*\*/,
    );
    expect(binding).toMatch(/`corpus thread show`/);
    for (const label of [
      "`a general resident`",
      "`researcher (doc_b7c1d5)`",
      "`researcher (profile missing)`",
    ]) {
      expect(binding, `does not name ${label}`).toContain(label);
    }
    // And it is not the roster's trailing summary, which this skill forbids
    // deciding from one step earlier.
    expect(binding).toMatch(/a field of its own, and not the display text/);
  });

  it("says what a persona does not change, naming each thing it does not", () => {
    expect(binding).toMatch(
      /\*\*Nothing else about being resident turns on which reading you are in\.\*\*/,
    );
    const unchanged = binding.slice(binding.indexOf("Nothing else about being resident"));
    for (const part of [
      "lane you hold",
      "order you work it in",
      "how you settle it",
      "park that makes you\n   present",
      "stands one of two listeners down",
      "retirement",
      "resolved thread\n   ending the designation",
    ]) {
      expect(unchanged, `does not say ${part} is unchanged`).toContain(part);
    }
    expect(binding).toMatch(
      /A persona changes how you answer; it\s+never changes what is yours to answer/,
    );
  });

  it("forwards both fields at the launch and invents nothing for a null", () => {
    expect(launch, "the launch bullet is missing").not.toBe("");
    expect(launch).toMatch(/\*\*exactly as it came\*\* — every field, whatever it holds/);
    expect(launch).toMatch(/a subagent inherits\s+nothing and what you leave out of a prompt/);
    // The null is the ordinary arrival, named on the wire as it really comes.
    // AGENT-039: `weight` rides in the same object, so the ordinary payload is
    // three nulls rather than two — re-derived from a real server, below.
    expect(launch).toContain('{"name":null,"docId":null,"weight":null}');
    expect(launch).toMatch(/the nulls travel as nulls/);
    expect(launch).toMatch(/\*\*Invent nothing to fill\s+them\.\*\*/);
    // With the cost, which is what stops the placeholder coming back as a
    // convenience: the listener goes looking for a document nobody wrote.
    expect(launch).toMatch(/sends the listener looking\s+for a document nobody wrote/);
    expect(launch).toMatch(/Where `name` is set it is a profile the designation was made/);
  });

  it("carries no resident on a launch the roster asked for, rather than inventing one", () => {
    // The second launch trigger has no payload behind it at all, and the row's
    // rendering is prose for a person — passing it on is the placeholder again.
    const roster = orchestrate.slice(
      orchestrate.indexOf("- **A lane with nobody on it gets one"),
      orchestrate.indexOf("- **A row that does not read `live`"),
    );
    expect(roster, "the roster-launch bullet is missing").not.toBe("");
    expect(roster).toMatch(
      /\*\*A launch made from the roster carries no resident, and must not invent one\.\*\*/,
    );
    expect(roster).toMatch(/words written for a person to read/);
    expect(roster).toMatch(/Give the launch the thread id, and the weight below, and nothing else/);
    // And what makes that safe rather than lossy: the listener reads its own
    // designation, which is the step pinned above.
    expect(roster).toMatch(wrapped("reads its own designation out of the corpus"));
  });

  it("works the ordinary designation in both skills, and says what a profiled one changes", () => {
    // AGENT-019's shape: the example is what gets copied, so the example is the
    // general resident and the profiled case is stated against it rather than
    // the other way round.
    const example = converse.slice(converse.indexOf("## Worked example"));
    expect(example).toMatch(/A general resident is on `th_4b8e2c`/);
    expect(example).toContain(
      'th_4b8e2c "Q3 planning" · a general resident · waiting for a listener',
    );
    expect(example).toMatch(/there is no persona to read, because none was named/);
    expect(example).toMatch(/\*\*Had the payload named one\*\*/);
    expect(example).toMatch(/not one other line of this example would differ/);
    // The launch example agrees: the same payload shape, the same roster words.
    expect(launch).toContain(
      'th_4b8e2c "Q3 planning" · a general resident · waiting for a listener',
    );
    expect(launch).toMatch(/launched a converse listener on th_4b8e2c — a general resident/);
    expect(launch).toMatch(/Had that designation named `researcher`, three things would read/);
    // No example may print a resident cell the CLI does not render. `renderLane`
    // prints `residentLabel`, which is `a general resident` or `name (docId)` or
    // `name (profile missing)` — never a bare profile name (`commands/resident.ts`).
    for (const body of [converse, orchestrate]) {
      for (const block of fencedBlocks(body).filter((fence) => fence.info === "bash")) {
        for (const line of block.content.split("\n")) {
          const row = /^\s*(th_\w+ "[^"]*") · ([^·]+) ·/.exec(line);
          if (row === null) continue;
          expect(row[2]?.trim(), `${row[1]}: a resident cell no CLI renders`).toMatch(
            /^a general resident$|^\S+ \((?:doc_\w+|profile missing)\)$/,
          );
        }
      }
    }
  });
});

/**
 * AGENT-039, SPEC.md §7's weight rider (signed 2026-08-19). SHARED-055 moved a
 * resident's weight onto the designation, so the orchestrator — the only thing
 * that launches a listener — is what turns a level key into a model. Before
 * this, a listener ran at whatever the launcher happened to default to: chosen
 * by nobody, recorded nowhere.
 *
 * Every transcript pinned here was re-derived against a real server (throwaway
 * workspace, port 8897, 2026-08-19), because AGENT-036 is what happens when a
 * transcript drifts from what the CLI prints:
 *
 * ```
 * $ corpus thread designate th_a5jqfkyp --weight heavy
 * designated a general resident at heavy on th_a5jqfkyp
 * $ corpus queue claim-all
 * … "payload":{"threadId":"th_a5jqfkyp","resident":{"name":null,"docId":null,"weight":"heavy"}} …
 * … "payload":{"threadId":"th_aqzmadcs","resident":{"name":null,"docId":null,"weight":null}} …
 * $ corpus agents
 * orchestrator · waiting for a listener
 * th_aqzmadcs "No weight lane" · a general resident · waiting for a listener
 * th_a5jqfkyp "Order drill" · a general resident at heavy · waiting for a listener
 * $ corpus thread release th_a5jqfkyp && corpus queue claim-all
 * … "type":"resident.released","payload":{…,"resident":{…,"weight":"heavy"},"reason":"released"} …
 * ```
 *
 * Three things that measurement settled, each of which the text would otherwise
 * have had to guess at:
 *
 * - **A lane that chose no weight prints nothing extra**, so the roster clause
 *   has to read an absent token as *you decide* rather than as a level.
 * - **A key the table does not declare is accepted and printed verbatim**
 *   (`… at featherweight`), which is why the unmet-weight rule binds a launch
 *   exactly as it binds a dispatch — the launcher is the first thing that can
 *   notice, and a listener posts no reply about its own launch.
 * - **A re-designation that changes only the weight emits a pair**, a
 *   `resident.released` with `reason: "replaced"` and the new
 *   `resident.designated`, on one lane. No order is asserted here: SERVER-131
 *   sorts a batch by the conversation's order, and the skill is held to reading
 *   the two as one act rather than to which arrives first — **when they share a
 *   batch at all**, which AGENT-040 measured they need not: a claim between the
 *   two writes splits them, and the split-pair pins below are that issue's.
 */
describe("a listener launched at its designation's weight", () => {
  const body = documentAt("claude/skills/orchestrate/SKILL.md").body;
  const routing = body.slice(body.indexOf("## Routing"), body.indexOf("## Delegation"));
  const launch = routing.slice(
    routing.indexOf("- **Launching a listener.**"),
    routing.indexOf("- **Losing a listener.**"),
  );
  const losing = routing.slice(
    routing.indexOf("- **Losing a listener.**"),
    routing.indexOf("- **A lane that already has a listener"),
  );
  const occupied = routing.slice(
    routing.indexOf("- **A lane that already has a listener"),
    routing.indexOf("- **A lane with nobody on it gets one"),
  );
  const roster = routing.slice(
    routing.indexOf("- **A lane with nobody on it gets one"),
    routing.indexOf("- **A row that does not read `live`"),
  );

  /** The models this workspace's own table declares, read off the table itself. */
  const declaredModels = readWeightLevels(body).map(({ model }) => model);

  it("resolves the designation's weight through the tier table", () => {
    expect(launch, "the launch bullet is missing").not.toBe("");
    // The lookup itself: a key names a row, and the row names the model. The
    // launch is the only place a level key becomes a model for a resident.
    expect(launch).toMatch(
      wrapped(
        "**Find the row whose Key cell holds it, and launch the listener at that row's model.**",
      ),
    );
    expect(launch).toMatch(/carries a \*\*Key\*\* from the tier table in Delegation below/);
    // The routing row says the same thing where a reader meets it first.
    const designation = routing.split("\n").find((line) => line.includes("`resident.designated`"));
    expect(designation ?? "").toMatch(/at the model that `resident`'s `weight` names/);
    // `null` is the orchestrator's own judgment, not a hidden default — and it
    // is logged, because a listener answers for weeks on that one choice.
    expect(launch).toMatch(/A `null` weight is \*you decide\*/);
    expect(launch).toMatch(/on a subject that is a whole conversation rather than\s+one turn/);
    expect(launch).toMatch(/log the model you launched at on the designation's own event/);
    // And the example logs a model this workspace's table actually declares.
    const logged = /launched a converse listener on \S+ — a general resident \(([^ ]+) —/.exec(
      launch,
    )?.[1];
    expect(declaredModels, `the launch example logs "${logged ?? "nothing"}"`).toContain(logged);
  });

  it("hands an unmeetable weight to the listener in words, as well as to the log", () => {
    expect(launch).toMatch(
      wrapped(
        "**A weight you cannot meet is stated twice, and here the launch prompt is one of the two.**",
      ),
    );
    // One rule, not a second copy of it: Delegation states the causes.
    expect(launch).toMatch(/Delegation below gives the three causes and the rule/);
    expect(launch).toMatch(/Launch anyway, at what your own judgment gives you/);
    // The three facts, and why the prompt has to carry them: a listener has no
    // reply of its own to put them in.
    expect(launch).toMatch(/what was asked\s+for, that it could not be met, and what runs instead/);
    expect(launch).toMatch(/A listener posts no reply about its\s+own launch/);
    // Where they land is the converse skill's, and this one points rather than
    // states it — the AGENT-029 shape, one account per rule.
    expect(launch).toMatch(
      /\*\*Where\s+they land in it is the converse skill's to state, and it is stated there alone\.\*\*/,
    );
  });

  it("routes a release to a log and a completion, and launches nothing for it", () => {
    const row = routing.split("\n").find((line) => line.includes("`resident.released`"));
    expect(row ?? "", "no routing row for resident.released").not.toBe("");
    expect(row ?? "").toMatch(/Nothing is dispatched and nothing is launched/);
    expect(losing, "the release bullet is missing").not.toBe("");
    // All three reasons, because each is a different thing a person did.
    for (const reason of ["`released`", "`resolved`", "`replaced`"]) {
      expect(losing, `does not name reason ${reason}`).toContain(reason);
    }
    expect(losing).toMatch(/Log who left and the reason, complete the event, and go on/);
    // The listener is not told and not stood down — the consequence only.
    expect(losing).toMatch(/You never\s+tell that listener and you never stand it down/);
    // The lane afterwards is the fallback's, which the skill already handles.
    expect(losing).toMatch(/worked on your lane again, under the routing every other thread gets/);
    // The worked transcript, re-derived: the payload carries the departing
    // resident with its weight, and a `reason`.
    const fences = fencedBlocks(losing).filter((fence) => fence.info === "bash");
    expect(fences.length, "the release bullet works no example").toBe(1);
    const worked = fences[0]?.content ?? "";
    expect(worked).toContain('"type":"resident.released"');
    expect(worked).toContain('"resident":{"name":null,"docId":null,"weight":"heavy"}');
    expect(worked).toContain('"reason":"released"');
    expect(worked).toMatch(/corpus job log \S+ "[^"]*reason: released"/);
    expect(worked).toMatch(/corpus queue complete/);
    // `replaced` arrives with its designation — on one claim, or on two.
    expect(losing).toMatch(/\*\*`replaced` is the one reason that is not an ending\*\*/);
  });

  /**
   * AGENT-040, reported from live use 2026-08-21: the release and its
   * designation arrived **9 seconds apart on two separate claims**, so the
   * skill's "it never arrives alone" never fired, the live check declined the
   * launch, and the lane was left with a leaver and a designation nobody acted
   * on. Nothing in §7 or the queue pairs the two events: they share a claim
   * only when both are pending when that claim runs, and a release and the
   * designation after it are separate writes at separate times. Measured on a
   * real server (throwaway workspace, port 8899, 2026-08-21), with a scoped
   * park holding the lane `live` throughout:
   *
   * - `thread release` → claim → `thread designate` → claim: the release came
   *   back on the first claim **alone**, and the designation on the second —
   *   with the still-held release visible only in `inProgress`. That is the
   *   reported shape, and the pre-fix live check declines it.
   * - An **exact-repeat** designation emitted `resident.designated` alone — no
   *   release — so the decline branch below is precisely the repeat-on-a-live-
   *   lane case, and the release memory separates the two exactly.
   * - A weight-changing re-designation emitted the pair, both in one batch when
   *   both were still pending.
   * - After the park ended, `corpus agents` still printed `live, parked 19s
   *   ago` with nobody parked — the grace reading the exception text names.
   */
  it("no longer claims the pair shares a claim, and carries a lone release forward", () => {
    // The false invariant, gone in both of its halves.
    expect(losing, "the false invariant is back").not.toMatch(/never arrives\s+alone/);
    expect(losing, "the pairing claim is back").not.toMatch(
      /the same\s+claim carries the `resident.designated`/,
    );
    // What replaced it: both shapes are ordinary, and neither is waited on.
    expect(losing).toMatch(
      /Events share a claim only when\s+both were pending when that claim ran/,
    );
    expect(losing).toMatch(
      /a release and the designation after it are\s+separate writes at separate moments/,
    );
    expect(losing).toMatch(/nine seconds apart being as ordinary as together/);
    // Paired: one act, in whichever order the batch printed them.
    expect(losing).toMatch(/read\s+them as one act, in whichever order the batch printed them/);
    // Split: the release is settled alone and remembered for the rule below.
    expect(losing).toMatch(/Where the release comes alone, settle it\s+alone/);
    expect(losing).toMatch(/\*\*carry it forward\*\*/);
    expect(losing).toMatch(/until a launch follows on that\s+lane/);
  });

  /**
   * The second AGENT-040 defect, the one that repeats: `live` on a lane whose
   * release this session has processed means *someone is leaving* — the
   * outgoing listener holds its park until it next unparks, and the row keeps
   * reading `live` for a grace window after any park ends — so the old rule
   * read a leaver as an answered lane and declined every launch. The fix is the
   * reporter's own sentence: a live row does not hold back a launch when this
   * session has already processed a release on that same lane.
   */
  it("launches onto a live row when this session has processed that lane's release", () => {
    expect(occupied, "the occupied-lane bullet is missing").not.toBe("");
    // The decline branch survives, scoped to the no-release case.
    expect(occupied).toMatch(
      /\*\*Where no release has passed through this session for\s+this lane, `live` means the lane is already answered\.\*\*/,
    );
    // The exception, as the reporter phrased it.
    expect(occupied).toMatch(
      /\*\*A live row does not hold back a launch when this session has already processed a\s+`resident.released` on that same lane with no launch since — there, `live` means someone\s+is leaving\.\*\*/,
    );
    expect(occupied).toMatch(/whether the\s+release shared this claim or came two claims ago/);
    // Why the row reads live while nobody answers: park until unpark, then the
    // grace window — with no number, which stays the server's.
    expect(occupied).toMatch(/learns it was replaced only when it next unparks/);
    expect(occupied).toMatch(/reading `live` for a grace\s+window after any park ends/);
    // The launch prompt says it follows a release, for the successor's own
    // startup read — and what it does with that is converse's, not restated.
    expect(occupied).toMatch(/Say in the launch prompt that this launch\s+follows a release/);
    expect(occupied).toMatch(/what it does with it is the converse skill's to\s+state/);
    // Two listeners, briefly, is the acceptable case — for the stated reason.
    expect(occupied).toMatch(/the one already there is leaving by construction/);
    // The launch spends the memory and counts as the pass's launch, so neither
    // a second designation nor the fallback doubles it up.
    expect(occupied).toMatch(/The launch spends the carried\s+release/);
    expect(occupied).toMatch(/the pass's one launch for that lane/);
    expect(occupied).toMatch(/the once-a-pass rule below counts\s+it/);
    // The following pass does not read a live row as a failed launch.
    expect(occupied).toMatch(
      /a row that reads `live` is this launch working, since the new\s+listener parks as the old one leaves/,
    );
    // Where the memory lives, and why losing it to a restart needs no repair.
    expect(occupied).toMatch(/your own session and nothing else/);
    expect(occupied).toMatch(/there is no store to write\s+it into and none to consult/);
    expect(occupied).toMatch(
      /a\s+restart that forgets every release also ends every listener you launched/,
    );
    expect(occupied).toMatch(/launches with no memory needed/);
  });

  it("reads the weight off the roster row while still inventing no resident", () => {
    expect(roster, "the roster-launch bullet is missing").not.toBe("");
    expect(roster).toMatch(
      wrapped("**The weight is the one thing you do read off the row, and reading it invents"),
    );
    // Why reading it is not the invention the paragraph above forbids: a key is
    // a token the table declares, not a rendering of who is resident — and it is
    // not the row's trailing summary, which the next bullet forbids deciding
    // from and which a rewrite would otherwise sweep this clause into.
    expect(roster).toMatch(
      wrapped("a **Key** is a token the tier table declares rather than a rendering of anybody"),
    );
    expect(roster).toMatch(wrapped("It is also not the summary the next bullet warns you off"));
    expect(roster).toContain("`a general resident at heavy`");
    expect(roster).toMatch(
      wrapped("find its row in the tier table, and launch at that row's model"),
    );
    // An absent token is the choice nobody made, never a level.
    expect(roster).toMatch(
      wrapped("A row that prints nothing after the resident is a designation that chose no weight"),
    );
    // And the launch still carries no resident, which is the older half.
    expect(roster).toMatch(
      /\*\*A launch made from the roster carries no resident, and must not invent one\.\*\*/,
    );
  });

  it("states in one reading what a changed weight does to a live lane", () => {
    expect(occupied, "the occupied-lane bullet is missing").not.toBe("");
    // AGENT-040: a changed weight is the release case — launched now, at the
    // new weight — not the old wait-for-the-fallback rule, which left the lane
    // to two grace windows of nobody while the person watched.
    expect(occupied).toMatch(
      /\*\*A weight that changed is this release case, not a third one\.\*\*/,
    );
    expect(occupied, "the wait-for-the-fallback rule is back").not.toMatch(/launch nothing now/i);
    expect(occupied).toMatch(/you launch now, at the new weight/);
    // The invariant this rule rests on, stated as an outcome and pointed home.
    expect(occupied).toMatch(
      /No running agent\s+becomes another model without discarding the conversation it holds/,
    );
    expect(occupied).toMatch(
      /\*\*When it goes, and how it finds out, is the\s+converse skill's to state\.\*\*/,
    );
    // The old listener is still never stood down by the orchestrator.
    expect(occupied).toMatch(/Standing it down yourself is still not yours to do/);
  });

  /**
   * AGENT-041, reported from live use 2026-08-21: *"there's no way to specify
   * the model when starting the resident."* The skill said "launch the listener
   * at that row's model" and never said how — no `model:`, no argument, nothing
   * — so the only followable instruction was to write the model's name into the
   * prompt, and the subagent ran on whatever the session inherited. That is the
   * failure SHARED-055 was signed to end: a choice discarded silently by an
   * instruction whose failure clause cannot detect its own failure. The gap was
   * Delegation-wide, not listener-only — ordinary dispatch also named the model
   * as a prompt field — so the mechanism is pinned where dispatch is owned, and
   * the launch sites are pinned as consumers of it.
   */
  it("chooses the runtime with the Task call's model argument, never with prose", () => {
    const delegation = body.slice(body.indexOf("## Delegation"), body.indexOf("## Writing a"));
    // The mechanism, named where every dispatch is owned.
    expect(delegation).toMatch(
      /\*\*The call's `model` argument is what chooses the runtime, and the prompt chooses\s+nothing\.\*\*/,
    );
    expect(delegation).toMatch(/The Task tool takes `model` beside `prompt`/);
    expect(delegation).toMatch(/set it on \*\*every\*\* launch this skill makes/);
    // The spelling, so the instruction is executable rather than described.
    expect(delegation).toMatch(
      /the model's lowercase family name, so the Sonnet\s+row travels as `sonnet` and the Opus 5 row as `opus`/,
    );
    // The failure mode, stated as what it is: silent substitution.
    expect(delegation).toMatch(/A model named only in the prompt's\s+prose selects nothing/);
    expect(delegation).toMatch(/nothing anywhere records that a choice was dropped/);
    // Shown, not described: a call carrying both, in a fence a revert to prose
    // would have to delete.
    const calls = fencedBlocks(delegation).filter((fence) => fence.content.includes("Task("));
    expect(calls.length, "delegation shows no Task call").toBeGreaterThan(0);
    expect(calls[0]?.content ?? "").toMatch(/model: "sonnet"/);
    expect(calls[0]?.content ?? "").toMatch(/prompt:/);
    // The prompt line's one job, said plainly.
    expect(delegation).toMatch(/that line is written for the subagent, never for the\s+runtime/);
    expect(delegation).toMatch(/selection already happened in the argument above it/);
    // A refused value routes into the unmeetable-weight rule, concretely.
    expect(delegation).toMatch(/the launch call's `model` argument comes back refused/);
    expect(delegation).toMatch(/make the\s+call again with the value your own judgment picks/);
    // The tier table's Model column is tied to the argument it fills.
    expect(delegation).toMatch(/the value the launch call's `model`\s+argument carries/);
  });

  it("launches the listener through the same model argument, and keeps the prompt a name", () => {
    // The launch site consumes the mechanism rather than restating it.
    expect(launch).toMatch(/that row's model goes out as the call's\s+`model` argument/);
    expect(launch).toMatch(/Delegation\s+states the argument and its spelling/);
    // The conflation the issue named, unpicked in one sentence.
    expect(launch).toMatch(
      /the prompt is how the resident\s+learns its name, and the argument is how the runtime is chosen/,
    );
    expect(launch).toMatch(
      /A model named in the prose\s+alone launches a listener on whatever model this session inherited, silently/,
    );
    // A runnable launch, showing the argument beside the /converse prompt.
    const calls = fencedBlocks(launch).filter((fence) => fence.content.includes("Task("));
    expect(calls.length, "the launch bullet shows no Task call").toBeGreaterThan(0);
    expect(calls[0]?.content ?? "").toMatch(/model: "sonnet"/);
    expect(calls[0]?.content ?? "").toMatch(/\/converse th_\w+/);
    // The example's argument and its prompt name the same tier, and the tier is
    // one this workspace's table declares — the AGENT-026 rule, applied here.
    expect(calls[0]?.content ?? "").toMatch(/running as Sonnet/);
    expect(declaredModels).toContain("Sonnet");
    // The roster launch names the same argument rather than acquiring its own.
    expect(roster).toMatch(/the same\s+`model` argument on the same Task call/);
  });

  it("keeps a designation's weight out of everything the resident hands off", () => {
    const delegation = body.slice(body.indexOf("## Delegation"), body.indexOf("## Writing a"));
    expect(delegation).toMatch(
      wrapped("**A designation's weight reaches the resident's own turns and stops there.**"),
    );
    expect(delegation).toMatch(/it is stated on no event/);
    expect(delegation).toMatch(/nothing carries it into work that\s+resident hands off/);
    // The gap this closes: a hand-off no message stated a weight for is judged,
    // by the resident, from the same table the orchestrator judges from.
    expect(delegation).toMatch(
      wrapped(
        "**A hand-off no message stated a weight for is judged from this table, in the two passes above, exactly as you judge one**",
      ),
    );
    expect(delegation).toMatch(/by the resident, on its own lane/);
  });
});

/**
 * AGENT-034. The skill that writes a subagent profile.
 *
 * Two things are pinned here and they are pinned for different reasons.
 *
 * **The mechanism**, which SERVER-123 moved into the server on 2026-08-17 and
 * which this file therefore pins in its new position rather than its old one.
 * Claude Code still loads a profile only when **both** `name` and `description`
 * are present — measured against a real session: with neither, with `name`
 * alone, and with `description` alone, the profile is absent from the subagent
 * list. What changed is who supplies them. `corpus doc create --type agent-def`
 * now derives `name` from the allocated filename (a caller-supplied one that
 * disagrees is a `400`) and defaults `description` to the title, and `corpus
 * doc check` reports either fault as a blocking `frontmatter-invalid` error. So
 * the skill's second command is no longer the difference between a persona and
 * a file — the server is — and the text is held to saying so: `--extra name=`
 * is gone, the read-back is gone, and what remains is the description as a
 * **quality** step over a title the server can copy but cannot improve on.
 *
 * **The worked example against the skill's own prose**, because AGENT-026 is
 * the defect this repo has already shipped: an example contradicting the rule
 * above it teaches the example. Each assertion below pairs one stated rule with
 * the place the example obeys it, so a future edit to either half has to move
 * both.
 */
describe("profile skill body", () => {
  const body = documentAt("claude/skills/profile/SKILL.md").body;

  /**
   * The path the worked example's create printed, the title that produced it,
   * and the address that follows from the two. Read off the path rather than
   * off an `--extra name=`, because since SERVER-123 the name is the filename
   * and the skill passes nothing: the title is the only input the example has.
   *
   * The title is read out of the **heredoc that builds it**, not off the flag,
   * because the flag now carries `"$title"` — see *values a shell cannot read*
   * below for why it has to.
   */
  const examplePath = /created doc_\w+ — (\.claude\/agents\/[a-z0-9-]+)\.md/.exec(body)?.[1];
  const heredocValue = (variable: string): string | undefined =>
    new RegExp(
      String.raw`^${variable}=\$\(cat <<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF\n\)$`,
      "m",
    ).exec(body)?.[1];
  const exampleTitle = heredocValue("title");
  const exampleName = examplePath?.slice(".claude/agents/".length);

  it("carries its sections, each of them substantial", () => {
    const sections = new Map<string, string[]>();
    let current: string | null = null;
    for (const line of body.split("\n")) {
      if (line.startsWith("## ")) {
        current = line.slice(3).trim();
        sections.set(current, []);
      } else if (current !== null) {
        sections.get(current)?.push(line);
      }
    }
    expect(sections.size).toBe(7);
    for (const [heading, lines] of sections) {
      expect(lines.join("\n").trim().length, `section "${heading}" is thin`).toBeGreaterThan(400);
    }
  });

  it("teaches the create as the whole profile and the description as the judgement", () => {
    expect(body).toMatch(/corpus doc create --type agent-def --title/);
    expect(body).toMatch(/--extra description="\$description"/);
    // The reason the second command exists, stated as the consequence rather
    // than as a step: this is what a reader skips if it reads as bookkeeping.
    // Since SERVER-123 the consequence is a profile nobody picks, not one that
    // cannot load, and the text must not go on claiming the older, larger one.
    expect(body).toMatch(/the one field worth your judgement/);
    expect(body).toMatch(/a quality step and not a repair/);
    expect(body).toMatch(/a working profile\s+nobody has a reason to pick/);
  });

  it("passes no name, and says why the field is the server's", () => {
    // The redundancy SERVER-123 created, shed rather than left harmless: a
    // `name` that agrees is accepted and one that disagrees is a `400`, so the
    // flag can only ever be noise or an error.
    //
    // Tightened from `--extra name=<value>` to the flag *named at all* (PR #49,
    // review 4). The text used to explain the derivation by saying `--extra
    // name=…` "is refused at exit **5**", in a paragraph about `corpus doc
    // create` — which has no `--extra` flag: measured 2026-08-18, it is
    // `unknown flag "--extra" for "create"` at exit **2**, with no request
    // sent, and the flag list `corpus doc create --help` prints is `--type
    // --title --folder --tags --due --evergreen --pinned --order --query
    // --column --message --file --job`. Exit 5 is the *edit* path's answer, and
    // whose answer it is has been under repair twice. So the skill states the
    // durable half — the field is the server's, derived from the filename — and
    // names no code for a refusal it cannot reach.
    expect(body, "the skill names `--extra name` on the create path again").not.toMatch(
      /--extra name/,
    );
    expect(body, "an exit code is attached to the name field again").not.toMatch(
      /name[^\n]*refused at exit/,
    );
    expect(body).toMatch(/\*\*The name is not yours to set\.\*\*/);
    expect(body).toMatch(/from the filename\s+it just allocated/);
    expect(body).toMatch(/this create takes no flag that names it/);
    // Both resolvers named, since the mismatch is only comprehensible as two of
    // them disagreeing.
    expect(body).toMatch(/Corpus resolves `@<name>` from the file's path/);
    expect(body).toMatch(/Claude\s+Code\s+resolves it from this field/);
    expect(body).toMatch(/one\s+document two different addresses/);
  });

  /**
   * PR #49, review 4. The read-back was dropped on the strength of two claims,
   * and only one of them was ever true of the shipped server.
   *
   * - **The create cannot produce an incomplete profile** — still true, and now
   *   true for a reason the agent can act on: `docs/create.ts`'s
   *   `claudeCodeFields` derives `name` from the allocated filename and defaults
   *   `description` to the title, and `corpus doc create` exposes no flag that
   *   names either field, so the shape cannot be asked for. Measured 2026-08-18:
   *   `--title "Bookkeeper"` alone writes `name: bookkeeper` and
   *   `description: Bookkeeper`, and `corpus doc check` finds nothing.
   * - **"the write path refuses to save one"** — false since `write.ts`'s
   *   `isClaudeCodeRequirement` ("reported, never refused"), which is the whole
   *   of the SERVER-123 regression fix: blocking the save made every
   *   hand-authored profile uneditable, unarchivable and unrepairable. Measured
   *   on the same workspace, against a hand-written `.claude/agents/` file
   *   carrying `name` and no `description`: a body edit, an `--add-tag`, an
   *   archive and an unarchive all exit **0**, and `--json` reports
   *   `"warnings":[]` — nothing on the wire at all. `corpus doc check` reports
   *   the same file as an error and exits **6**.
   *
   * So the asymmetry is pinned in both directions, because the false half is
   * exactly the half an agent generalises from when it edits a profile rather
   * than creating one: the guarantee is the create's, a write to an existing
   * profile promises nothing, and `doc check` is the surface.
   */
  it("names doc check as the check, and keeps the pass no check can make", () => {
    // The read-back existed because nothing else looked. Something else looks
    // now, so keeping it would teach ceremony — and teaching the agent to
    // verify what the server guarantees is how a skill stops being read.
    expect(body, "the read-back survived the mechanism that replaced it").not.toMatch(
      /corpus doc show doc_\w+ --json \| jq/,
    );
    expect(body).toMatch(/\*\*There is nothing to read back\.\*\*/);
    expect(body).toMatch(/neither is something\s+this create lets you pass/);
    expect(body).toMatch(/What reports a profile Claude Code cannot load/);
    expect(body).toMatch(/is `corpus doc check`/);
    // The refusal that never was. A save reports and proceeds; a skill saying
    // otherwise teaches the agent to trust exit 0 as a load check.
    expect(body, "the skill claims a refusal the write path does not make").not.toMatch(
      /write path refuses/,
    );
    expect(body).toMatch(/belongs to the create and stops there/);
    expect(body).toMatch(/a write\s+to that file succeeds and tells you nothing/);
    expect(body).toMatch(/never read a write's success as evidence that anything loads/);
    // What the server cannot check is the whole reason this skill exists.
    expect(body).toMatch(/whether the body says anything worth\s+following; that pass is yours/);
  });

  it("keeps writing a profile separate from putting it to work", () => {
    expect(body).toMatch(/\*\*Writing a profile and putting it to work are two acts/);
    expect(body).toMatch(/user-only/);
    // The skill hands the designation over; it never runs one itself, which is
    // checkable: an agent-authored designation is the shape that would be wrong.
    for (const line of body.match(/[^\n]*corpus thread designate[^\n]*/g) ?? []) {
      expect(line, "the skill designates instead of handing it over").not.toContain("--from agent");
    }
    // A resident needs no profile at all (SPEC.md §7, rider 2026-08-17), which
    // is the answer when the request is really about staffing a conversation.
    expect(body).toMatch(/a resident \*\*need not have a profile at all\*\*/);
  });

  it("refuses a taken name rather than inventing a free one", () => {
    expect(body).toMatch(/already taken in \.claude\/agents/);
    expect(body).toMatch(/exit \*\*5\*\*/);
    expect(body).toMatch(/a second persona at an address the person will never type/);
    // Revising the existing one is a different request, not a fallback.
    expect(body).toMatch(/\*\*Revising it is a different request and needs\s+their yes\*\*/);
    expect(body).toMatch(/never edit a profile you\s+did not just create/);
  });

  /**
   * AGENT-036, and this pin exists to **stop a fix** rather than to require one.
   *
   * The sentence was filed as false and is now true, by a change to the product
   * rather than to the prose. `targetIndex`
   * (`apps/server/src/threads/mentions.ts`) skips any row whose `invocableName`
   * is null — the title alias included — so a `type: agent-def` document filed
   * outside `.claude/agents/` is addressable under no spelling at all
   * (SERVER-125). Measured 2026-08-18 against a real server: `corpus doc create
   * --type agent-def --title Ledgerclerk --folder inbox` wrote
   * `data/docs/inbox/ledgerclerk.md`, and a turn reading *"Does @ledgerclerk
   * resolve, and does @bookkeeper?"* queued a `comment.created` whose payload
   * carried `"mentions":[{"name":"bookkeeper",…}]` and
   * `"unresolved":["@ledgerclerk"]`.
   *
   * It survived a change of mechanism because it states a **consequence**. Every
   * previous correction to this file replaced a consequence with somebody's
   * account of another component's internals, and every one of those went stale;
   * so what is pinned is the consequence *and the absence of a mechanism beside
   * it* — a sentence reciting the resolver's two aliases would already be wrong.
   *
   * PR #50 second review, NIT 8: the mechanism check ran over the whole file
   * and forbade `alias` and `autocomplete` case-insensitively, which is two
   * ordinary English words banned from a product file for good — a future
   * sentence about the composer's autocomplete would have failed a pin about
   * the mention resolver. It now runs over the bullet it guards, and the two
   * server identifiers stay case-sensitive because that is what they are.
   */
  it("keeps a misfiled profile's consequence, and names no mechanism for it", () => {
    expect(body).toMatch(/Never retry into a different folder/);
    expect(body).toMatch(
      /a document \*about\* an agent rather than an agent, and it resolves\s+to nobody\./,
    );
    // The bullet, from its bolded lead-in to the blank line or next bullet.
    const bullet = /- \*\*The write is refused for any other reason\.\*\*[\s\S]*?(?=\n- \*\*)/.exec(
      body,
    )?.[0];
    expect(bullet, "the misfiled-profile bullet moved").toBeDefined();
    expect(bullet, "the bullet recites how the resolver indexes a row").not.toMatch(
      /targetIndex|invocableName|\balias(?:es)?\b|indexed under|skips any row/i,
    );
  });

  it("states what makes a persona worth having, in behavioural terms", () => {
    expect(body).toMatch(/A profile that changes nothing is decoration/);
    expect(body).toMatch(/name two things this\s+agent would do differently/);
    expect(body).toMatch(/\*\*Write behaviour, not biography\.\*\*/);
    expect(body).toMatch(/The refusals are half the profile/);
    expect(body).toMatch(/Say what a finished answer looks like/);
    expect(body).toMatch(/Short enough to stay true/);
    expect(body).toMatch(/It inherits; it does not restate/);
    // The description has a different reader from the body — the rule that
    // makes a persona findable rather than merely correct.
    expect(body).toMatch(/only part\s+of the file another agent sees before dispatching/);
  });

  it("gathers in one turn where it gathers at all, and refuses a blank request", () => {
    expect(body).toMatch(/ask, and ask \*\*once\*\*/);
    expect(body).toMatch(/Three questions is the whole budget/);
    expect(body).toMatch(/Where the request already carries all three, write the profile/);
    expect(body).toMatch(/is not thin, it is blank/);
  });

  /**
   * The AGENT-026 pins: each one reads a rule out of the prose and the matching
   * decision out of the worked example. They fail on a change to either half.
   */
  it("works an example whose title produces the address the rule promises", () => {
    expect(body).toMatch(/One word where you can, hyphenated\s+where you must, never a phrase/);
    expect(body).toMatch(/the title you pass decides that filename/);
    expect(examplePath, "the example's create prints no path").toBeDefined();
    expect(exampleTitle, "the example's create passes no title").toBeDefined();
    // The chain the skill now teaches, end to end on the one place a reader
    // will copy from: title → slugged filename → the `@name` the reply offers.
    // It replaces the old `--extra name=` pin, which pinned a flag that is now
    // redundant at best and a `400` at worst.
    const slugged = (exampleTitle ?? "").toLowerCase().replaceAll(/\s+/g, "-");
    expect(`.claude/agents/${slugged}`).toBe(examplePath);
    expect(exampleName, "the worked name is not the one word the rule asks for").not.toContain("-");
  });

  it("works an example description written as when to reach for the agent", () => {
    expect(body).toMatch(/write it as \*when to reach for this\s+one\*/);
    const worked = body.slice(body.indexOf("## Worked example"));
    const description = /^description=\$\(cat <<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF\n\)$/m.exec(
      worked,
    )?.[1];
    expect(description, "the worked example builds no description").toBeDefined();
    expect(description).toMatch(/^Reach for this when /);
  });

  /**
   * AGENT-036. The worked example transcribed the roster check as `showing 0
   * documents`, which `corpus doc list` emits on **no path at all**: `runDocList`
   * (`apps/cli/src/commands/doc/list.ts`) returns on an empty page before
   * `renderTally` is reached, so an empty result is `no documents match.`, and
   * the tally line — `showing 1–0 of 0 documents`, had it been reachable — never
   * renders. Measured 2026-08-18 on a fresh workspace: the command printed `no
   * documents match.` and exited 0; after one create it printed the row and
   * `showing 1–1 of 1 document`.
   *
   * Nobody is misled into a wrong action by it, since the agent reads what the
   * command actually returned. What it costs is the transcript's standing as a
   * contract: a skill author matching on `showing ` to spot an empty roster
   * writes a branch that never fires.
   *
   * Pinned against the **emitting source** rather than as a literal, because the
   * defect is a transcript nobody ran. A change to the CLI's wording now fails
   * here, naming the skill that has to follow it.
   *
   * The extraction reads the source with its whitespace collapsed and takes the
   * first two string literals after the branch condition, rather than matching
   * the ternary as it is currently laid out (PR #50, NIT 10). Every way that
   * branch can be re-laid-out — prettier wrapping after the `?`, or the ternary
   * becoming an `if`/`else` — is whitespace or ordering that this survives, and
   * a pin that a reflow turns red is a pin somebody deletes. What is left is the
   * failure worth having: the condition going away, or either message being
   * reworded, both of which really do invalidate the transcript.
   */
  it("transcribes the empty roster as the CLI actually prints it", () => {
    const listSource = readFileSync(
      path.join(REPO_ROOT, "apps/cli/src/commands/doc/list.ts"),
      "utf8",
    );
    const flatSource = listSource.replaceAll(/\s+/g, " ");
    const branchAt = flatSource.indexOf("page.offset === 0");
    expect(branchAt, "doc list no longer branches on an empty first page").toBeGreaterThan(-1);
    // The two messages in source order: the first page's, then a later page's.
    const [emptyLine, laterPage] = [
      ...flatSource.slice(branchAt, branchAt + 200).matchAll(/"([^"]*)"/g),
    ].map((match) => match[1]);
    expect(emptyLine, "the empty-first-page branch names no message").toBeTruthy();
    expect(body).toContain(`corpus doc list --type agent-def\n${emptyLine ?? ""}`);
    // The neighbouring branch, which is the wrong line to transcribe for a
    // roster read that passes no offset: an empty *later* page is a different
    // state and the skill would be teaching a check that cannot fire.
    expect(laterPage, "the branch has only one message").toBeTruthy();
    expect(body, "the roster transcribes the later-page message").not.toContain(laterPage ?? " ");
    // Both forms the file must not go back to: the one that shipped, and the
    // tally `renderTally` would have produced had an empty page reached it.
    expect(body, "the unreachable empty tally is back").not.toMatch(/showing 0 documents/);
    expect(body, "an empty roster is transcribed as a tally line").not.toMatch(/showing 1–0/);
  });

  /**
   * PR #49, third review. Both of this skill's writes carried person-authored
   * words in a shell-quoted flag argument, and the two quoting styles fail on
   * different characters — measured against a real workspace, 2026-08-17:
   *
   * - `--title "Kitchen quote $18,400"` created
   *   `data/docs/inbox/kitchen-quote-400.md` with `title: Kitchen quote ,400`,
   *   exit 0, committed. `$18` is a positional parameter and it is empty. This
   *   is AGENT-035, and it is **silent**.
   * - `--extra note='it's fine'` never runs (`unexpected EOF while looking for
   *   matching '`); with an even number of apostrophes it runs and the CLI
   *   refuses the fragments (`unexpected argument "fine,"`). This one is
   *   **loud** — and that is exactly why it matters, because the obvious repair
   *   for a broken single quote is a double quote, which is the silent hole
   *   above. The skill states the pair as a pair for that reason.
   *
   * The CLI offers no way out: `-m`, `--file` and stdin feed the **body** alone,
   * so there is no `--title-file` and no stdin form for `--extra` (checked
   * against `corpus doc edit --help`, 2026-08-17). The fix is therefore the
   * shell idiom the body already uses, lifted onto the short arguments: a
   * `<<'CORPUS_EOF'` heredoc into a variable, and the variable passed in double quotes.
   * Nothing is expanded on either leg, so the rule needs no list of dangerous
   * characters.
   *
   * Pinned in the tightening direction, because the previous drill proved the
   * **example** is what gets copied: the raw quoted forms must be gone from the
   * file, the safe form must be what both writes spell, and the worked
   * description must actually contain an apostrophe — an example that avoids
   * the character the rule exists for demonstrates nothing.
   *
   * **AGENT-035 took the explanation out of this file and left the practice.**
   * The account above was the only one anywhere, and it turned out to bind
   * every skill rather than this one — a thread title is where it was reported
   * from. So `orchestrate` states the mechanism now, under the single-owner
   * registry, and what stays pinned here is what this skill *does*: two writes,
   * both values built by a quoted heredoc, no raw quoted form anywhere in an
   * invocation, and a pointer instead of a second account.
   */
  it("routes every word a person reads through a heredoc, not a quoted argument", () => {
    expect(body).toMatch(
      /\*\*Both values below are somebody else's, so both go in through a heredoc, passed by name\.\*\*/,
    );
    // A pointer, not a restatement: the mechanism lives in one file, and this
    // skill says which. `one rule, one skill` holds the other half — that no
    // account of the expansion survives here.
    expect(body).toMatch(/is the orchestrate skill's to state, and it is\s+stated there alone\./);
    // The one thing this skill adds to the rule it defers to: here it is
    // unconditional, because both of its values are always somebody else's.
    expect(body).toMatch(/binds both of them every time, the ones that look safe included/);

    // Negative pins, over the **invocations** rather than the whole body: the
    // prose above names both broken forms on purpose, and a pin that could not
    // tell an invocation from the sentence explaining it would forbid the
    // explanation.
    const commandLines = body.split("\n").filter((line) => line.trimStart().startsWith("corpus "));
    expect(commandLines.length, "the skill invokes nothing").toBeGreaterThan(0);
    for (const line of commandLines) {
      expect(line, "a literal double-quoted --title is back").not.toMatch(/--title "(?!\$)/);
      expect(line, "an --extra value is single-quoted again").not.toMatch(/--extra [a-z-]+='/);
    }

    // And the safe form is what both writes spell, in both places they appear.
    const creates = commandLines.filter((line) =>
      line.includes("corpus doc create --type agent-def"),
    );
    expect(creates.length, "the skill no longer writes a create").toBeGreaterThanOrEqual(2);
    for (const line of creates) expect(line).toContain('--title "$title"');
    const descriptionEdits = commandLines.filter((line) => line.includes("--extra description"));
    expect(
      descriptionEdits.length,
      "the skill no longer sets a description",
    ).toBeGreaterThanOrEqual(2);
    for (const line of descriptionEdits) {
      expect(line).toContain('--extra description="$description"');
    }
    // Every value the skill passes by name is built by a quoted heredoc first.
    for (const variable of ["title", "description"]) {
      expect(heredocValue(variable), `${variable} is passed but never built`).toBeDefined();
    }
    // The example carries the character the rule exists for; otherwise the
    // pattern that gets copied is the one that has never been exercised.
    const worked = body.slice(body.indexOf("## Worked example"));
    const description = /^description=\$\(cat <<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF\n\)$/m.exec(
      worked,
    )?.[1];
    expect(description, "the worked description carries no apostrophe").toMatch(/\w'\w/);
  });

  it("works an example persona that obeys the body rules above it", () => {
    // Scoped to the worked example: *Writing it* runs the same agent through a
    // skeleton whose body is a stand-in, and holding that stand-in to the
    // persona rules would be checking the wrong text.
    const worked = body.slice(body.indexOf("## Worked example"));
    expect(worked, "no worked-example section").not.toBe("");
    const profileBody =
      /--type agent-def --title "[^"]+" --from agent <<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF/.exec(
        worked,
      )?.[1];
    expect(profileBody, "no worked persona body").toBeDefined();
    const written = (profileBody ?? "").split("\n").filter((line) => line.trim() !== "");
    // "Short enough to stay true", checked rather than asserted in prose.
    expect(written.length, "the worked persona is longer than the rule allows").toBeLessThanOrEqual(
      12,
    );
    // "The refusals are half the profile."
    expect(profileBody).toMatch(/\bNever\b|\bdo not\b/);
    // "Say what a finished answer looks like."
    expect(profileBody).toMatch(/A good answer from you is/);
    // "It inherits; it does not restate" — the worked persona repeats none of
    // the workspace's own doctrine, which is the rule most easily broken by
    // somebody making the example look thorough.
    expect(profileBody).not.toMatch(/corpus |archive|--from agent/i);
  });

  it("reports the four things a person needs, and its example reports them", () => {
    expect(body).toMatch(/\*\*what you created, where it lives, what it does, and how to reach it/);
    const reply =
      /corpus thread reply [^\n]*<<'CORPUS_EOF'\n([\s\S]*?)\nCORPUS_EOF/.exec(body)?.[1] ?? "";
    expect(reply, "no worked reply").not.toBe("");
    expect(reply, "the reply names no sigil").toContain(`@${exampleName ?? ""}`);
    expect(reply, "the reply names no path").toContain(`${examplePath ?? ""}.md`);
    expect(reply, "the reply hands over no designation").toContain("corpus thread designate");
    // The skill tells the agent to say what it guessed; the example does.
    expect(body).toMatch(/every assumption you made instead of asking/i);
    expect(reply).toMatch(/One guess in there/);
  });
});

/**
 * AGENT-032 — the class rather than the instance.
 *
 * Four review findings in three passes have come from one rule written into two
 * skills and then maintained in one of them. The last was load-bearing:
 * `orchestrate` justified *"Launch, and let the lane settle it"* with the
 * discriminator AGENT-031 had **deleted** from `converse` — *"its claim comes
 * back empty on work its own park had just named"* — while `converse` said
 * *"judge it on that id, and never on the claim being empty"*. Nothing in this
 * file compared the two, so the contradiction shipped green.
 *
 * Two pins, because the duplication arrives in two shapes and neither catches
 * the other:
 *
 * - **Copied prose** is caught mechanically, by shared passage. Every passage
 *   the skills state twice today is recorded below with the reason it is stated
 *   twice, so a new one fails here rather than at a reviewer.
 * - **A paraphrase** defeats that — AGENT-029 wrote the same rule into both
 *   files in different words — so a rule known to be single-owner is registered
 *   with the mechanism's own vocabulary. The owner must state it; nobody else
 *   may; and a skill that relies on it carries the outcome and a pointer.
 *
 * Neither pin decides where a rule belongs. What they enforce is that the
 * decision is made once and recorded, which is the part that was missing.
 */
describe("one rule, one skill", () => {
  const SKILLS = ["orchestrate", "converse", "comment", "profile"] as const;
  type SkillName = (typeof SKILLS)[number];

  const skillBody: Record<SkillName, string> = {
    orchestrate: documentAt("claude/skills/orchestrate/SKILL.md").body,
    converse: documentAt("claude/skills/converse/SKILL.md").body,
    // The package, not the body: text AGENT-047 moved into `references/` is
    // still the comment skill's text, and a rule restated there would drift
    // exactly as one restated in the body would.
    comment: commentPackage,
    profile: documentAt("claude/skills/profile/SKILL.md").body,
  };

  /** Prose paragraphs of a skill body: fenced blocks dropped, wrapped lines rejoined. */
  const proseBlocks = (body: string): string[] => {
    const blocks: string[] = [];
    let current: string[] = [];
    let inFence = false;
    for (const line of body.split("\n")) {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (line.trim() === "") {
        if (current.length > 0) blocks.push(current.join(" "));
        current = [];
        continue;
      }
      current.push(line.trim());
    }
    if (current.length > 0) blocks.push(current.join(" "));
    return blocks;
  };

  const proseSentences = (body: string): string[] =>
    proseBlocks(body)
      .flatMap((block) => block.split(/(?<=[.!?])\s+/))
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence !== "");

  /**
   * A body as a word stream, with everything a re-wrap or a re-emphasis changes
   * taken out. Comparing words rather than lines is what makes the pin survive
   * ordinary editing: reflowing a paragraph moves no word, and copying it into
   * the other skill moves all of them.
   */
  const proseWords = (body: string): string[] =>
    proseBlocks(body)
      .join(" ")
      .toLowerCase()
      .replaceAll(/[*_`>#|]/g, " ")
      .replaceAll(/[^a-z0-9%\-/.:'’]+/g, " ")
      .split(/\s+/)
      .filter((word) => word !== "");

  /**
   * Twelve words is about a clause, and it is where the two error rates cross.
   * Measured on these three bodies: at six words `orchestrate` and `converse`
   * share 258 runs, nearly all of them ordinary vocabulary, and every one would
   * have to be recorded below; at twelve they share 13, each a real restatement.
   * Going higher only lets a copied sentence through — most are shorter than
   * twenty words.
   */
  const PASSAGE_WORDS = 12;

  const shingles = (words: readonly string[]): string[] => {
    const out: string[] = [];
    for (let index = 0; index + PASSAGE_WORDS <= words.length; index += 1) {
      out.push(words.slice(index, index + PASSAGE_WORDS).join(" "));
    }
    return out;
  };

  /** The maximal passages of `left` whose every shingle also occurs in `right`. */
  const sharedPassages = (left: readonly string[], right: readonly string[]): string[] => {
    const known = new Set(shingles(right));
    const passages: string[] = [];
    let start: number | null = null;
    for (let index = 0; index + PASSAGE_WORDS <= left.length; index += 1) {
      const shared = known.has(left.slice(index, index + PASSAGE_WORDS).join(" "));
      if (shared && start === null) start = index;
      if (!shared && start !== null) {
        passages.push(left.slice(start, index - 1 + PASSAGE_WORDS).join(" "));
        start = null;
      }
    }
    if (start !== null) passages.push(left.slice(start).join(" "));
    return passages;
  };

  /**
   * Every passage two skills state today, with why. An entry is a decision that
   * a rule is worth saying twice — not a licence for the next one, and not a
   * claim that the duplication is a good idea. Entries are not asserted to be
   * still in use: one going stale means a duplication was removed, which is the
   * direction this pin exists to encourage.
   */
  const STATED_TWICE: readonly { readonly why: string; readonly passages: readonly string[] }[] = [
    {
      why: "the invariants a resident inherits — `converse` restates them condensed and names `orchestrate` as their authority, and `comment` states the same ones for a subagent that reads neither loop skill",
      passages: [
        "and go there when a detail is missing. 1. every mutation goes through the corpus cli. workspace files are never hand-edited not with an editor not with your own file tools not with shell redirection and the http api is never called directly. the server is the sole writer. 2. attribution is explicit.",
        "not with an editor not with your own file tools not with shell redirection and",
        "run export corpus from agent once at the start of the session and still pass --from agent on",
        "and still pass --from agent on mutating commands the way the examples below",
        "the way the examples below do. 3. you archive you never delete. where a person would delete",
        "corpus doc archive . deletion belongs to the user alone and the cli refuses it from you. 4.",
        "belongs to the user alone and the cli refuses it from you.",
        "a write presents the key its read gave you. replacing a document's body",
        "what it costs you to find something must not grow with the corpus. reading a body",
      ],
    },
    {
      why: "the loop's own shape — both skills run a loop, and each states the steps of its own rather than pointing at the other's",
      passages: [
        "by nobody with no error anywhere and nothing in the console to show for it. run these steps in order indefinitely: 1.",
        "is the entire command never appended to the claim above it never combined with",
        "it parks the full window and prints idle :true reason : halted",
        "just claimed and inprogress what the server still thinks you are doing.",
        "is not a correctness failure the server still never hands one event to two",
      ],
    },
    {
      why: "the settling grammar — both skills settle events, on their own lanes, and the reason a person reads is written the same way in both",
      passages: [
        "short sentence naming the object and the obstacle it is what the",
        "and the person waiting on it gets no reply and no failed row to explain the silence.",
      ],
    },
    {
      why: "delegation, which a resident does under `orchestrate`'s rules for a side task and `orchestrate` does for every event",
      passages: [
        "in the job's log while it runs and in the reply the",
        "one request stays one piece of work with one status and one reply whatever it took internally.",
      ],
    },
    {
      why: "*Writing a document* — stated in full in both `orchestrate` and `comment`. This is the same class as AGENT-032 and is recorded rather than fixed: it is not this issue's subject, and freezing it is what stops it growing further",
      passages: [
        "read work write with the key you were given keep the key the write returned.",
        "means passing the --key that corpus doc show printed and the write prints a fresh key for the next edit.",
        "- a fence closes only on a line that is nothing but backticks",
        "the fence stays open to the end of the turn and a turn heading inside a fence is",
        "a change you can quote is a patch a change you cannot quote is a",
        "if you can point at the text that is wrong a figure a sentence a paragraph that should go",
        "and puts every other line in your hands where a bad paste",
        "a patch presents no key and that is a consequence rather than an",
        "across the gap the tail of what comes before and the head of what comes after as one excerpt",
        "two refusals exit 10 both nothing written and their recoveries are opposites. the message names the count so branch on it rather than guessing.",
        "quote more of what surrounds it until it occurs exactly once the line above",
        "--all replaces every occurrence and is right only when every occurrence is genuinely what you meant never",
        "reading a document prints its key a write that replaces the body presents that key the write prints a fresh",
        "a key the document has moved past is exactly the statement i am about to overwrite something i never read",
        "two refusals on a keyed write and only the first is a mistake.",
        "the text you read and run the same command again with the fresh key. that retry is the mechanism working not a failure to report and",
        "putting an older version back is this same loop. there is no revert command and",
        "a revert is a write whose content came from history so it",
        "corpus doc diff id prints the document's path and its last committed change and",
        "read from git never write to it. git log git show and git diff are",
        "the body. everything down to and including the closing --- is frontmatter the server owns",
        "so pasting the file in as a body writes that frontmatter into the document",
        "the version you just read so a revert that would clobber a change made since that read is refused with exit 9",
        "landing on top of it. the age of the content is never the question what happened after your read is. a patched revert is guarded",
      ],
    },
    {
      why: "the pointer formula itself. AGENT-035 is the first single-owner rule whose consumers are the other three skills rather than `orchestrate`, so the closing clause of a pointer now occurs in four files. It is identical on purpose: it is what marks a sentence as a pointer rather than a second account, and the registry below matches it. Only the clause is shared — each pointer names a different thing about the rule it defers",
      passages: ["is the orchestrate skill's to state, and it is stated there alone."],
    },
    {
      why: "stewardship, which binds whoever does the work — `orchestrate` states the charter and `comment` states the parts a turn carries",
      passages: [
        "is how their writing disappears and every thread anchored into an entry you rewrote comes loose",
        "the arrow a space then a one-line past-tense report of what the work did as in",
        "when you keep meeting the same mess propose the sweep in a reply instead of quietly starting it.",
      ],
    },
  ];

  const recorded = new Set(
    STATED_TWICE.flatMap(({ passages }) => passages).flatMap((passage) =>
      shingles(proseWords(passage)),
    ),
  );

  /** Every passage of `left` that `right` also states and nothing above accounts for. */
  const undeclaredDuplication = (left: SkillName, right: SkillName): string[] =>
    sharedPassages(proseWords(skillBody[left]), proseWords(skillBody[right])).filter((passage) =>
      shingles(proseWords(passage)).some((shingle) => !recorded.has(shingle)),
    );

  const PAIRS: readonly (readonly [SkillName, SkillName])[] = [
    ["orchestrate", "converse"],
    ["orchestrate", "comment"],
    ["converse", "comment"],
    ["orchestrate", "profile"],
    ["converse", "profile"],
    ["comment", "profile"],
  ];

  it("records nothing that records nothing", () => {
    // A passage shorter than one shingle contributes no shingle, so it would
    // sit here declaring a decision it does not actually permit.
    for (const { passages } of STATED_TWICE) {
      for (const passage of passages) {
        expect(
          proseWords(passage).length,
          `"${passage}" is shorter than a shared passage and permits nothing`,
        ).toBeGreaterThanOrEqual(PASSAGE_WORDS);
      }
    }
    expect(recorded.size).toBeGreaterThan(0);
  });

  it("finds the duplication it is looking for, before it is asked to find none", () => {
    // Anti-vacuity in both directions. The recorded passages are really shared,
    // so a normalizer that silently matched nothing would fail here — and a
    // paragraph moved from one skill into the other is really reported, which
    // is the case the pin exists for, proven without touching a file.
    expect(
      sharedPassages(proseWords(skillBody.orchestrate), proseWords(skillBody.converse)).length,
    ).toBeGreaterThan(0);
    const borrowed = proseSentences(skillBody.converse).find((sentence) =>
      sentence.includes("An id your park named, held by somebody else when you claim"),
    );
    expect(borrowed, "the stand-down rule is missing from converse").toBeDefined();
    const copied = sharedPassages(
      proseWords(`${skillBody.orchestrate}\n\n${borrowed ?? ""}\n`),
      proseWords(skillBody.converse),
    ).filter((passage) => shingles(proseWords(passage)).some((shingle) => !recorded.has(shingle)));
    expect(copied.length, "a paragraph copied between the skills goes unreported").toBeGreaterThan(
      0,
    );
  });

  it("states no passage in two skills that is not a recorded decision", () => {
    for (const [left, right] of PAIRS) {
      expect(
        undeclaredDuplication(left, right),
        `${left} and ${right} now state the same passage. Delete one and point at the skill that owns the rule — or, if it genuinely belongs in both, record it in STATED_TWICE with the reason`,
      ).toEqual([]);
    }
  });

  /**
   * A rule one skill owns and another relies on. `restatements` is a per-rule
   * detector for the shapes the rule gets written in, so the registry catches
   * what the passage pin cannot: the same rule written twice in different words,
   * which is how AGENT-029 shipped it into both files.
   *
   * **It is a net, not a proof — and only one of the two rules below is
   * exhaustive.** The weight table's detector reads the table's own rows, so no
   * restatement of a level can miss it. The stand-down rule's is a collocation
   * match over prose, and a paraphrase that avoids the collocation passes: *"the
   * id it expected to claim comes back held by another caller"* states the whole
   * rule and matches nothing here. Its vocabulary covers the shapes the rule has
   * actually been written in — the two historical ones and the near neighbours a
   * rewrite reaches for first — and deliberately no wider, because a pin that
   * fires on unrelated prose is a pin somebody baselines away, which costs more
   * than a narrow one. So: widen the vocabulary the moment a paraphrase gets
   * past it, and never read a green run as proof that no second skill states the
   * rule. That judgement is still a reader's.
   */
  interface SingleOwnerRule {
    readonly rule: string;
    readonly owner: SkillName;
    readonly restatements: (body: string) => readonly string[];
    /** Skills that rely on the rule: each carries the outcome and says where the rule lives. */
    readonly pointers: readonly { readonly skill: SkillName; readonly carries: RegExp }[];
  }

  // A sentence states the peer-listener discriminator when it says both halves:
  // that a park designated an id, and that somebody else came back holding it.
  // The first half is the collocation "park" + a designating verb (or that verb
  // applied to "pending"): `named` is what both skills have used, the rest are
  // the words a rewrite reaches for next. Requiring the word `park` — or the
  // word `pending` — is what keeps it off ordinary prose about claiming; both
  // halves must land in the same sentence before anything is reported.
  const PARK_NAMED =
    /park[^.]{0,24}?\b(?:nam|list|reserv|announc|flagg?|mark)(?:ed|es|e|ing)?\b|\b(?:nam|list|reserv|announc|flagg?|mark)(?:ed|es)?\s+(?:as\s+)?pending/i;
  const HELD_ELSEWHERE =
    /`inProgress`|held by|another (?:listener|caller)|second listener|claim comes back/i;

  // AGENT-035. A sentence explains what the shell does to an argument when it
  // names a character the shell acts on **and** what becomes of that argument.
  // The construction is deliberately not the vocabulary: every skill has to say
  // *build the value in a heredoc and pass `"$var"`*, because every skill
  // performs it, and `comment` may even say a title reaches the corpus as
  // `, ,400` — the outcome at the site of the defect is what a pointer carries.
  // What it may not do is explain that `$18` is a positional parameter or that
  // an apostrophe ends the quoting, because a second account of the mechanism
  // is what drifts the next time somebody rewrites one of the two.
  //
  // `backtick` is deliberately absent from the character list. Both loop skills
  // carry the fence rules, which are several paragraphs about backtick runs, and
  // a pin that fires on those is a pin somebody baselines away.
  const SHELL_CHARACTER =
    /positional parameter|\$18\b|dollar sign|\bapostrophes?\b|single quotes?|double quotes?/i;
  const SHELL_CONSUMES =
    /\bexpands?\b|\bexpanded\b|\beaten\b|\beats\b|ends the quoting|command substitution|\bjoins?\b|unmatched|is obeyed|\blands? as\b|arrives? (?:as|carrying)|reaches? the (?:document|server) as/i;

  // AGENT-045. The two registers of `corpus <verb> --help`, each named the way a
  // sentence choosing between them names it. `brief` on its own is deliberately
  // not enough: both loop skills use the ordinary word, and a pin that fires on
  // "a brief reply" is a pin somebody baselines away. The whole register has no
  // flag of its own — it is what bare `--help` prints — so it is matched by the
  // words a skill actually calls it by.
  const HELP_BRIEF_REGISTER = /--help=brief|\bbrief (?:help|form|register|text)\b/i;
  const HELP_WHOLE_REGISTER =
    /\b(?:whole|full) (?:help|text|register|form|description|prose)\b|\bthe prose\b|\bworked examples?\b/i;

  const SINGLE_OWNER_RULES: readonly SingleOwnerRule[] = [
    {
      rule: "how a second listener finds out it is second",
      owner: "converse",
      restatements: (body) =>
        proseSentences(body).filter(
          (sentence) => PARK_NAMED.test(sentence) && HELD_ELSEWHERE.test(sentence),
        ),
      pointers: [
        {
          skill: "orchestrate",
          carries:
            /\*\*How it finds\s+that out is the converse skill's to state, and it is stated there alone\.\*\*/,
        },
      ],
    },
    {
      rule: "the weight levels a request may state",
      owner: "orchestrate",
      restatements: (body) => readWeightLevels(body).map(({ name, key }) => `${name} (${key})`),
      // `comment` never chooses a model, so it carries no pointer — it is held
      // only to the prohibition, which is what a rule's non-consumers owe it.
      pointers: [{ skill: "converse", carries: /do not restate the table here/ }],
    },
    {
      // AGENT-034. The procedure has exactly two moving parts, and both are
      // vocabulary rather than phrasing, which is what makes them detectable at
      // all: the **flag** that creates the document, and the **pair of fields**
      // Claude Code reads. Both halves are still registered after SERVER-123
      // moved the second into the server, for two different reasons. The flag
      // is the procedure. The pair of fields is no longer something a skill has
      // to *do*, but it is still something a skill can wrongly explain — a
      // second account of what Claude Code requires would drift from this one
      // the next time the server changes underneath it, which is exactly what
      // happened to this skill — so it stays single-owner.
      //
      // `--type agent-def` is deliberately the flag and not the frontmatter
      // `type: agent-def`: the *fact* that a persona is a `type: agent-def`
      // document is exactly what `orchestrate` is allowed to keep, and pinning
      // the fact would forbid the sentence the issue asked to preserve. So the
      // hyphens carry the whole distinction between fact and procedure here.
      //
      // Net, not proof, in the same sense as the rule above: a restatement that
      // names neither the flag nor both fields — *"create the document, then
      // set the two fields Claude Code reads"* — passes, and the test below
      // says so out loud rather than letting the omission become invisible.
      rule: "how a persona profile is written",
      owner: "profile",
      restatements: (body) => [
        ...(body.match(/[^\n]*--type\s+agent-def[^\n]*/g) ?? []),
        ...proseSentences(body).filter(
          (sentence) =>
            /agent-def|persona|profile/i.test(sentence) &&
            /`name`[^.]{0,140}`description`|`description`[^.]{0,140}`name`/.test(sentence),
        ),
      ],
      pointers: [
        {
          skill: "orchestrate",
          carries:
            /\*\*What a persona has to carry, and how one is written, is the profile skill's to state, and\s+it is stated there alone\.\*\*/,
        },
      ],
    },
    {
      // AGENT-033. A designation may name no profile, and what the listener
      // does about that — read the document, or work as this workspace's
      // ordinary agent and say nothing, or work anyway and say the profile is
      // gone — is one rule, executed by the resident. `orchestrate` needs
      // exactly one thing out of it: that both fields travel as they came. A
      // second account of the binding there is the AGENT-029 shape again, and
      // this one has a live way to go wrong — the two skills disagreeing about
      // whether a general resident is worth a line in the first reply.
      //
      // The detector wants a sentence that names one of the three states **and**
      // prescribes what to do in it; naming a state alone is a fact any skill
      // may state, which is why `profile` (*"a designation that names none gets
      // a general resident"*) is not reported. Net, not proof, in the same sense
      // as the two rules above: a prescription that avoids the vocabulary
      // altogether passes, and the test below says which one.
      rule: "what a listener does with the profile it was designated with",
      owner: "converse",
      restatements: (body) =>
        proseSentences(body).filter(
          (sentence) =>
            /general resident|profile missing|named no profile|no profile (?:at all|was named)/i.test(
              sentence,
            ) &&
            /\bwork anyway\b|works? as it describes|says? (?:so|nothing)\b|first reply|reads? (?:it|that document)\b/i.test(
              sentence,
            ),
        ),
      pointers: [
        {
          skill: "orchestrate",
          carries:
            /\*\*What a listener does with either — a persona to\s+read, or none — is the converse skill's to state, and it is stated there alone\.\*\*/,
        },
      ],
    },
    {
      // AGENT-035. The other three skills all perform this — every one of them
      // sets a title, a description or an `--extra` value out of somebody's
      // words — so this is the first rule whose consumers outnumber its owner,
      // and the first with three pointers. `orchestrate` owns it because it is
      // the skill the other three already inherit their invariants from, and
      // because the rule is about talking to the CLI at all rather than about
      // any one verb.
      //
      // Net, not proof, in the same sense as the rules above: a sentence that
      // describes the loss without naming a character — *"the shell gets to
      // your text first and quietly changes it"* — states the whole rule and
      // matches nothing here, and the test below says so out loud.
      rule: "what the shell does to a value quoted into a flag argument",
      owner: "orchestrate",
      restatements: (body) =>
        proseSentences(body).filter(
          (sentence) => SHELL_CHARACTER.test(sentence) && SHELL_CONSUMES.test(sentence),
        ),
      pointers: [
        {
          skill: "comment",
          carries: wrapped(
            "**What the shell does to a flag argument, and why the heredoc is the answer, is the orchestrate skill's to state, and it is stated there alone.**",
          ),
        },
        {
          skill: "converse",
          carries: wrapped(
            "**What the shell does to a value you quote into a flag is the orchestrate skill's to state, and it is stated there alone.**",
          ),
        },
        {
          skill: "profile",
          carries: wrapped(
            "**What the shell would otherwise do to those two values is the orchestrate skill's to state, and it is stated there alone.**",
          ),
        },
      ],
    },
    {
      // AGENT-045. `--help=brief` saves ~80% of a help read, so every skill has
      // a reason to name the flag — and naming a flag is not the rule. The rule
      // is **which register a reading needs**, and it has exactly one shape that
      // can be wrong in a way nobody sees: a skill that teaches *brief is enough*
      // sends an agent to write a `--columns` list with a board's column missing
      // out of it, at exit 0. So the outcome — *ask for brief* — is what a
      // pointer carries, and the three arms of the choice stay in `orchestrate`.
      //
      // The detector wants a sentence that names the **brief register** and the
      // **whole register** together, because that pairing is what a choice
      // between them is written with. Naming one alone is a fact any skill may
      // state, which is what keeps both pointers below off the pin: `comment`
      // says brief is a lookup and never mentions the prose, and `converse` says
      // the same and defers the rest.
      //
      // Net, not proof, in the same sense as the rules above: a restatement that
      // names the registers by nothing but their flags — *"read `--help=brief`
      // unless a bad value would write something silently"* — states the rule
      // and matches nothing here, and the test below says so out loud.
      rule: "which register of a command's help a reading needs",
      owner: "orchestrate",
      restatements: (body) =>
        proseSentences(body).filter(
          (sentence) => HELP_BRIEF_REGISTER.test(sentence) && HELP_WHOLE_REGISTER.test(sentence),
        ),
      pointers: [
        {
          skill: "comment",
          carries: wrapped(
            "**Which register a reading needs is the orchestrate skill's to state, and it is stated there alone.**",
          ),
        },
        {
          skill: "converse",
          carries: wrapped(
            "**When the whole text is the right call is the orchestrate skill's to state, and it is stated there alone.**",
          ),
        },
      ],
    },
  ];

  it("keeps every registered rule in the one skill that owns it", () => {
    for (const { rule, owner, restatements, pointers } of SINGLE_OWNER_RULES) {
      expect(
        restatements(skillBody[owner]).length,
        `"${rule}" is registered to ${owner}, which no longer states it`,
      ).toBeGreaterThan(0);
      for (const skill of SKILLS.filter((name) => name !== owner)) {
        expect(
          restatements(skillBody[skill]),
          `${skill} restates "${rule}", which ${owner} owns. Say the outcome you rely on and point at ${owner}`,
        ).toEqual([]);
      }
      for (const { skill, carries } of pointers) {
        expect(
          skillBody[skill],
          `${skill} relies on "${rule}" without pointing at ${owner}`,
        ).toMatch(carries);
      }
    }
  });

  it("reports the restatement that shipped, which is what makes the registry worth having", () => {
    // The pre-fix orchestrate sentence, verbatim from `phase-4-agent-loop`. It
    // described the rule in the form AGENT-031 had already deleted from
    // converse, and every check in this file passed over it.
    const shipped =
      "A second listener parks, costs nothing while the conversation is quiet, and the " +
      "first message it is asked to answer tells it what it is: its claim comes back empty " +
      "on work its own park had just named, which on a live lane only another listener can " +
      "cause, and it exits.";
    const standDown = SINGLE_OWNER_RULES.find(({ rule }) =>
      rule.startsWith("how a second listener"),
    );
    expect(standDown, "the stand-down rule is no longer registered").toBeDefined();
    expect(
      standDown?.restatements(shipped) ?? [],
      "the registry would have passed over the sentence that shipped",
    ).not.toEqual([]);
    expect(standDown?.restatements(skillBody.orchestrate) ?? ["unchecked"]).toEqual([]);
  });

  it("catches the near paraphrases, and says out loud which one it does not", () => {
    // The docblock above claims a net rather than a proof. These are the claim,
    // executable: a substituted designating verb is caught, and the paraphrase
    // that drops the mechanism's vocabulary altogether is not. If somebody
    // widens the vocabulary far enough to catch the last one, this test fails
    // and the docblock's admission gets rewritten with it — which is the only
    // way that admission cannot quietly become false.
    const standDown = SINGLE_OWNER_RULES.find(({ rule }) =>
      rule.startsWith("how a second listener"),
    );
    const caught = [
      "the event its park listed as pending comes back held by another caller",
      "an event this park flagged as pending returns held by another caller",
      "the row your park marked pending is held by another caller when you claim",
    ];
    for (const sentence of caught) {
      expect(
        standDown?.restatements(sentence) ?? [],
        `a designating-verb paraphrase now evades the pin: "${sentence}"`,
      ).not.toEqual([]);
    }
    expect(
      standDown?.restatements("the id it expected to claim comes back held by another caller") ?? [
        "unchecked",
      ],
      "the pin now catches a paraphrase the docblock says it misses — correct the docblock",
    ).toEqual([]);
  });

  it("catches both halves of the profile procedure, and says which paraphrase it misses", () => {
    // The same claim as the docblock, executable. The flag and the field pair
    // are each enough on their own to report a restatement, because a skill
    // that teaches only one of them teaches a broken profile — and the prose
    // form that names neither is admitted as the gap it is.
    const writing = SINGLE_OWNER_RULES.find(({ rule }) => rule.startsWith("how a persona"));
    expect(writing, "profile writing is no longer registered").toBeDefined();
    const caught = [
      '```bash\ncorpus doc create --type agent-def --title "Archivist" --from agent\n```',
      "A persona needs both `name` and `description` in its frontmatter, or nothing loads it.",
      "Without a `description` beside the `name`, the agent-def is invisible to a dispatch.",
    ];
    for (const sample of caught) {
      expect(
        writing?.restatements(sample) ?? [],
        `a restatement of the profile procedure now evades the pin: "${sample}"`,
      ).not.toEqual([]);
    }
    expect(
      writing?.restatements(
        "Create the persona document, then set the two fields Claude Code reads.",
      ) ?? ["unchecked"],
      "the pin now catches a paraphrase the docblock says it misses — correct the docblock",
    ).toEqual([]);
  });

  it("catches a second account of the expansion, and says which paraphrase it misses", () => {
    // AGENT-035. The failure this guards is a second skill acquiring its own
    // explanation of what the shell eats — which is how the guidance would come
    // to disagree with itself about whether single quotes are the repair. The
    // three below are the shapes that account has actually been written in.
    const shell = SINGLE_OWNER_RULES.find(({ rule }) => rule.startsWith("what the shell does"));
    expect(shell, "the expansion rule is no longer registered").toBeDefined();
    const caught = [
      "`$18` is a positional parameter, so a title carrying $18,400 arrives as `,400`.",
      "An apostrophe inside a single-quoted argument ends the quoting early and is deleted.",
      "Inside double quotes the shell expands anything shaped like a variable.",
    ];
    for (const sentence of caught) {
      expect(
        shell?.restatements(sentence) ?? [],
        `a second account of the expansion now evades the pin: "${sentence}"`,
      ).not.toEqual([]);
    }
    // Stating the outcome without the mechanism is what a pointer does, and
    // `comment` states exactly that shape at the site of the reported defect.
    expect(
      shell?.restatements(
        "Quoted straight into the command, that title reaches the corpus as `cabinet quote, ,400`.",
      ) ?? ["unchecked"],
      "the pin now catches the outcome a pointer is allowed to carry",
    ).toEqual([]);
    expect(
      shell?.restatements("The shell gets to your text first and quietly changes it.") ?? [
        "unchecked",
      ],
      "the pin now catches a paraphrase the docblock says it misses — correct the docblock",
    ).toEqual([]);
  });

  it("catches a second account of the help registers, and says which paraphrase it misses", () => {
    // AGENT-045. Every skill has a reason to name `--help=brief`, so the shape
    // this guards is not a mention — it is a second skill acquiring its own
    // account of **when the whole text is worth reading**, which is the half
    // that can be wrong in a way nothing reports.
    const help = SINGLE_OWNER_RULES.find(({ rule }) => rule.startsWith("which register"));
    expect(help, "the help-register rule is no longer registered").toBeDefined();
    const caught = [
      "Read `--help=brief` for a name and the whole text when a wrong value writes silently.",
      "The brief form is a lookup and the full description is a lesson, so take the lookup.",
      "Reach for `--help=brief` unless you need the worked examples.",
    ];
    for (const sentence of caught) {
      expect(
        help?.restatements(sentence) ?? [],
        `a second account of the help registers now evades the pin: "${sentence}"`,
      ).not.toEqual([]);
    }
    // Naming one register is a fact any skill may state, and both pointers do.
    expect(
      help?.restatements(
        "Ask a command for `--help=brief` before you ask it for bare `--help`.",
      ) ?? ["unchecked"],
      "the pin now catches the outcome a pointer is allowed to carry",
    ).toEqual([]);
    expect(
      help?.restatements("A brief reply is worth more than a full one nobody reads.") ?? [
        "unchecked",
      ],
      "the pin now fires on the ordinary word `brief`, which is what would get it baselined",
    ).toEqual([]);
    expect(
      help?.restatements(
        "Read `--help=brief` unless a bad value would write something silently.",
      ) ?? ["unchecked"],
      "the pin now catches a paraphrase the docblock says it misses — correct the docblock",
    ).toEqual([]);
  });

  it("catches a second account of the binding, and says which paraphrase it misses", () => {
    // AGENT-033. The failure this guards is not a copied paragraph: it is
    // `orchestrate` acquiring its own opinion about whether a general resident
    // is worth mentioning, which is what the two skills would drift into.
    const binding = SINGLE_OWNER_RULES.find(({ rule }) =>
      rule.startsWith("what a listener does with the profile"),
    );
    expect(binding, "the binding rule is no longer registered").toBeDefined();
    const caught = [
      "Where the payload names no profile the listener is a general resident and says nothing about it.",
      "A general resident works as this workspace's ordinary agent does; a listener whose profile is missing says so in its first reply.",
      "If the profile is missing, work anyway — the general resident is the ordinary case.",
    ];
    for (const sentence of caught) {
      expect(
        binding?.restatements(sentence) ?? [],
        `a second account of the binding now evades the pin: "${sentence}"`,
      ).not.toEqual([]);
    }
    // Naming a state without prescribing anything is a fact, not the rule —
    // `profile` states exactly that shape and must not be reported for it.
    expect(
      binding?.restatements("A designation that names none gets a general resident.") ?? [
        "unchecked",
      ],
      "the pin now catches a paraphrase the docblock says it misses — correct the docblock",
    ).toEqual([]);
  });
});

describe("gitignore", () => {
  const rules = readTemplateFile("gitignore");

  it("ignores .corpus/ runtime state but re-includes the queue skeleton", () => {
    expect(rules).toContain(".corpus/*");
    expect(rules).toContain("!.corpus/queue/");
    expect(rules).toContain(".corpus/queue/*/*.json");
  });

  it("tracks the install manifest, which is provenance rather than runtime state", () => {
    // The blanket rule's own comment enumerates secret, derived and transient;
    // `.corpus/template-manifest.json` is none of the three, and tracking it is
    // what gives a clone its own `corpus workspace upgrade` baseline.
    expect(rules).toContain("!.corpus/template-manifest.json");
    expect(rules.indexOf("!.corpus/template-manifest.json")).toBeGreaterThan(
      rules.indexOf(".corpus/*"),
    );
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
      "## Global flags",
      "| Flag | Type |",
      "| ---- | ---- |",
      "| `--from <user\\|agent>` | string |",
      "## `corpus init`",
      "| `--port <n>` | number |",
      "## `corpus queue`",
      "### `corpus queue idle`",
      "## `corpus thread`",
      "### `corpus thread reply`",
      "| `--from-file <path>` | string |",
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
      "corpus thread reply th_4b8e2c --from agent <<'CORPUS_EOF'",
      "corpus queue resume restores it — this line is reply content, not a command.",
      "CORPUS_EOF",
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

  /**
   * Verbs the CLI **used to have**. `docs/cli.md` is generated from the CLI, so
   * once a verb is deleted the test above catches a skill that still names it —
   * but only after the reference is regenerated, and only while both land in the
   * same change. This guard is independent of the reference: it fails on the
   * template alone, so a skill can never quietly outlive the command it teaches.
   *
   * `corpus skill rollback` (SHARED-042, SPEC.md §7): it overwrote a whole file
   * with an old revision and destroyed uncommitted edits unrecoverably. It has
   * no replacement verb by design — a revert is a write whose content came from
   * history, so the skills teach the loop (read the history, work out the
   * content, write it with the key) instead of naming a command.
   */
  const REMOVED_VERBS = ["skill rollback"] as const;

  it("names no verb the CLI no longer has", () => {
    for (const relPath of templateFiles.filter((file) => file.endsWith(".md"))) {
      const invoked = new Set(
        extractCorpusInvocations(readTemplateFile(relPath)).map((tokens) =>
          normalizeInvocation(tokens, surface),
        ),
      );
      for (const verb of REMOVED_VERBS) {
        expect(invoked.has(verb), `${relPath} still invokes \`corpus ${verb}\``).toBe(false);
      }
    }
  });

  it("catches a removed verb wherever it is named", () => {
    // The guard above is only worth its line if it would actually fire.
    const invoked = extractCorpusInvocations(
      "Recover with `corpus skill rollback orchestrate`.\n",
    ).map((tokens) => normalizeInvocation(tokens, surface));
    expect(invoked).toContain(REMOVED_VERBS[0]);
  });

  /**
   * Flags the command a template invocation names does not declare, as
   * `<command> <flag>` pairs (AGENT-024).
   *
   * The invocation extractor drops flags, so until now a skill could spell
   * `corpus doc patch --key <k>` — the one flag that verb deliberately does not
   * have — and every check in this file would pass while the agent copying the
   * example got exit 2 and no write. This one only answers "does that command
   * take that flag", and the global table is merged into every command exactly
   * as the CLI merges it. A command `docs/cli.md` documents no flags for is left
   * entirely to the check above, so an undocumented verb fails once, naming the
   * verb, rather than once per flag it happened to carry.
   */
  const undocumentedFlagsIn = (source: string): string[] =>
    extractCorpusInvocationUses(source).flatMap(({ tokens, flags }) => {
      const command = normalizeInvocation(tokens, surface);
      if (command === null) return [];
      const declared = surface.flags.get(command);
      if (declared === undefined) return [];
      return flags
        .filter((flag) => !surface.globalFlags.has(flag) && !declared.has(flag))
        .map((flag) => `${command} ${flag}`);
    });

  it("spells no flag docs/cli.md does not document, across the template tree", () => {
    for (const relPath of templateFiles.filter((file) => file.endsWith(".md"))) {
      expect(undocumentedFlagsIn(readTemplateFile(relPath)), relPath).toEqual([]);
    }
  });

  // There was a second pass here over `installedSkills`, because a plugin's
  // skill lived outside the template tree and the check above could not see it.
  // INFRA-031 deleted `plugins/`, so every installed skill is now a file the
  // check above already reads — and it reads the whole file, frontmatter
  // included, where this one saw only the body.

  it("catches a flag the command does not have", () => {
    // The regression this exists for: `corpus doc patch` takes no `--key`
    // (SPEC.md §7 — the excerpt is the staleness check), and passing one is
    // exit 2 against a real server.
    expect(
      undocumentedFlagsIn(
        "```bash\ncorpus doc patch doc_a1b2c3 --key abc --old 'a' --new 'b'\n```",
      ),
    ).toEqual(["doc patch --key"]);
  });

  it("reads a flag-looking word inside a quoted value as the text it is", () => {
    // A patch quotes prose, and prose contains dashes. Only unquoted words are
    // flags — otherwise the check would fail on the document being edited.
    expect(
      undocumentedFlagsIn(
        "```bash\ncorpus doc patch doc_a1b2c3 --old 'ship it --tomorrow' --new ''\n```",
      ),
    ).toEqual([]);
  });

  /**
   * The spellings the first cut of this check missed, each probed directly
   * because each was invisible while the suite stayed green (PR #44 review).
   * They are ordinary shell, not exotica: an attached value, a quoted markdown
   * table row in a product made of markdown, a quoted semicolon, and the
   * multi-line excerpt every worked patch in the skills is written with.
   */
  it("reads a flag whose value is attached with `=`", () => {
    expect(
      undocumentedFlagsIn(
        "```bash\ncorpus doc patch doc_a1b2c3 --key='abc' --old 'a' --new 'b'\n```",
      ),
    ).toEqual(["doc patch --key"]);
  });

  it("does not let a quoted separator truncate the invocation", () => {
    // `|` and `;` inside a quoted value are that value's text. Splitting on
    // them first left every flag after a quoted table row or clause unread.
    expect(
      undocumentedFlagsIn("```bash\ncorpus doc patch doc_a1b2c3 --old '| a | b |' --key zzz\n```"),
    ).toEqual(["doc patch --key"]);
    expect(
      undocumentedFlagsIn("```bash\ncorpus doc patch doc_a1b2c3 --old 'a; b' --key zzz\n```"),
    ).toEqual(["doc patch --key"]);
  });

  it("reads the flags after a value that spans lines", () => {
    expect(
      undocumentedFlagsIn(
        "```bash\ncorpus doc patch doc_a1b2c3 --old 'line one\nline two' --key zzz --new 'x'\n```",
      ),
    ).toEqual(["doc patch --key"]);
  });

  it("reads a multi-line value as one invocation, whatever its lines start with", () => {
    // The line-wrap trap: a continuation line beginning with the word corpus
    // used to be extracted as a second, phantom invocation, which made a worked
    // example correct only by where its paragraph happened to wrap.
    const invocations = extractCorpusInvocationUses(
      "```bash\ncorpus doc patch doc_a1b2c3 --old 'Nothing else in the\ncorpus quoted those figures.' --new 'x'\n```",
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.flags).toEqual(["--old", "--new"]);
  });

  it("still splits on a separator outside quotes, and still cuts a comment", () => {
    // The joining must not cost the two behaviours it sits next to: chained
    // commands are separate invocations, and an apostrophe in a trailing
    // comment opens no quote — otherwise one `#` swallows the rest of a fence.
    const chained = extractCorpusInvocationUses(
      "```bash\ncorpus doc show d && corpus queue idle\n```",
    );
    expect(chained.map(({ tokens }) => normalizeInvocation(tokens, surface))).toEqual([
      "doc show",
      "queue idle",
    ]);
    expect(
      undocumentedFlagsIn(
        "```bash\ncorpus doc show d  # the document's own body\ncorpus doc patch d --key zzz --old 'a' --new 'b'\n```",
      ),
    ).toEqual(["doc patch --key"]);
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

  it("resolves the formerly-allowlisted verb that still exists against docs/cli.md itself", () => {
    // `corpus doc check` shipped and stayed. Its companion `corpus skill
    // rollback` shipped and was then **deleted** (SHARED-042): a revert is a
    // write whose content came from history, so it needs no verb. Asserting the
    // one and not the other is the whole difference, and the deletion is
    // guarded positively by "names no verb the CLI no longer has" above.
    expect(surface.commands.has("doc check"), "`corpus doc check` is documented").toBe(true);
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
