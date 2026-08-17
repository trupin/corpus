import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CORE_DOC_TYPES, DocumentIdSchema, IsoDateTimeSchema } from "@corpus/contract";
import { describe, expect, it } from "vitest";
// Read-only, and deliberately the real thing: `corpus init` creates exactly these
// directories, so importing them is what stops the install contract from drifting
// away from the implementation it documents.
import { WORKSPACE_DIRECTORIES } from "../apps/cli/src/commands/init/scaffold.js";
import {
  planPluginSkillInstall,
  planTemplateInstall,
  templateSkillNames,
} from "../apps/cli/src/template/install.js";
import {
  CLI_COMMANDS_PENDING_CLI_006,
  CONTRACT_DOC_PATH,
  INIT_GENERATED,
  INSTALL_FILTERS,
  INSTALL_RENAMES,
  PLUGINS_ROOT,
  REPO_ROOT,
  TEMPLATE_ROOT,
  TemplateError,
  WEIGHT_TABLE_HEADER,
  extractCorpusInvocationUses,
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
  readWeightLevels,
} from "./workspace-template.js";

/** The template tree, exhaustively. Adding a file is a deliberate change to this list. */
const EXPECTED_TREE = [
  "README.md",
  "claude/agents/.gitkeep",
  "claude/skills/comment/SKILL.md",
  "claude/skills/converse/SKILL.md",
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

/** A skill as it reaches a workspace's `.claude/skills/`, whatever tree it came from. */
interface InstalledSkill {
  /** The repo-relative source path — what a failure names. */
  readonly label: string;
  readonly body: string;
}

const templatePlan = planTemplateInstall(TEMPLATE_ROOT);

/**
 * Every skill document `corpus init` installs, from **both** trees: the
 * template's own and every plugin's `skills/<name>/` (SPEC.md §10). The plan is
 * the CLI's real installer rather than a glob re-written here, so a plugin that
 * ships a skill is swept the day it lands, and a skill the installer *skips* —
 * one whose name collides with a core skill — is not held to rules it never
 * reaches a workspace to break.
 *
 * This is the file set the rules in "every installed skill" run over. There is
 * deliberately no second inventory and no plugins-side copy of those assertions:
 * a plugin skill is prose the agent executes in a user's workspace, so what the
 * core skills teach binds it identically, from one list (PLUGINS-013).
 */
const installedSkills: readonly InstalledSkill[] = [
  ...templatePlan
    .filter((file) => file.to.startsWith(".claude/skills/") && file.to.endsWith(".md"))
    .map((file) => ({
      label: `assets/workspace/${file.from}`,
      body: documentAt(file.from).body,
    })),
  ...planPluginSkillInstall(PLUGINS_ROOT, templateSkillNames(templatePlan))
    .files.filter((file) => file.to.endsWith(".md"))
    .map((file) => ({
      label: `plugins/${file.from}`,
      body: parseFrontmatter(file.from, readFileSync(path.join(PLUGINS_ROOT, file.from), "utf8"))
        .body,
    })),
];

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
    expect(documents.length).toBe(8);
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
  const coreSkills = [...skills, { name: "converse", relPath: "claude/skills/converse/SKILL.md" }];

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

  it.each(coreSkills)("$name carries its required section headings", ({ name, relPath }) => {
    const headings = documentAt(relPath)
      .body.split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).toLowerCase());
    const requiredBySkill: Record<string, readonly string[]> = {
      orchestrate: [
        "purpose",
        "invariants",
        "the loop",
        "claiming",
        "routing",
        "delegation",
        "user edit",
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
        "gather context",
        "inbox filing",
        "reply",
        "forms",
        "skill genesis",
        "worked example",
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
        expect(lines[index + 1]?.trim(), `${relPath}: trace not last in its turn`).toBe("EOF");
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
   * Copyable canvases (SPEC.md §11, rider signed 2026-08-02): the reader draws
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

    it("spells out, in the comment skill, what an unclosed fence costs the reader", () => {
      const body = documentAt("claude/skills/comment/SKILL.md").body;
      expect(body).toMatch(/stays open to the end\s+of the turn/);
      expect(body).toMatch(/absorbed into the body of yours/);
      expect(body).toMatch(/It does not render badly; it makes the next message vanish/);
      // The fix is mechanical and stated as one: newline, then the run alone.
      expect(body).toMatch(
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
      const body = documentAt("claude/skills/comment/SKILL.md").body;
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
   * AGENT-021, SPEC.md §11's rider signed 2026-08-07. CLI-033 made `--model`
   * possible; this is what makes every agent turn actually carry one. The rule
   * is pinned where it decays fastest — in the *examples*, since an example
   * that posts a turn without stating a model teaches the opposite of the rule
   * and beats the rule that contradicts it (AGENT-019's bug survived rewrites
   * exactly that way).
   */
  describe("stating the model that wrote the turn", () => {
    it.each(skills)("$name works at least one turn-writing example", ({ relPath }) => {
      // The per-command `--model` check moved to the widened inventory below,
      // which covers these two skills and every plugin's alike (PLUGINS-013).
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
   * PLUGINS-013. The rules above are written for the template's two skills
   * because that is where they were first broken; none of them is *about* the
   * template. Once `corpus init` has run, a plugin's skill sits in the same
   * `.claude/skills/` and is read by the same agent, so it inherits them — and
   * the shipped `todos` skill had been teaching a reply with no `--model` since
   * the day AGENT-021 made stating one the rule, because the sweep that closed
   * it looked at one directory.
   *
   * So the *file set* is widened, and the assertions are not copied. Each core
   * skill keeps its own extra obligation next door — that it shows a
   * turn-writing example, a trace and a heredoc *at all* — which is a demand on
   * a skill that teaches the loop, not on every skill that ships.
   */
  describe("every installed skill", () => {
    it("reaches past the template, to a plugin skill that posts a turn", () => {
      // Anti-vacuity, in both directions the widening can fail silently: the
      // inventory has to be bigger than the template's own, and some plugin
      // skill has to actually post a turn — without which `--model` below would
      // pass by matching nothing at all.
      expect(installedSkills.length).toBeGreaterThan(skills.length);
      const fromPlugins = installedSkills.filter((skill) => skill.label.startsWith("plugins/"));
      expect(fromPlugins.map((skill) => skill.label)).toContain(
        "plugins/todos/skills/todos/SKILL.md",
      );
      expect(fromPlugins.some((skill) => turnCommands(skill.body).length > 0)).toBe(true);
    });

    it.each(installedSkills)("$label posts no example turn without a model", ({ label, body }) => {
      for (const command of turnCommands(body)) {
        expect(command, `${label}: turn written with no model`).toMatch(/ --model \S/);
      }
    });

    it.each(installedSkills)("$label puts a trace last in its turn, or none", ({ label, body }) => {
      const lines = body.split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line.trimStart().startsWith("↳")) continue;
        expect(lines[index + 1]?.trim(), `${label}: trace not last in its turn`).toBe("EOF");
      }
    });

    it.each(installedSkills)("$label quotes every heredoc it hands text to", ({ label, body }) => {
      for (const heredoc of body.match(/<<-?\s*\S+/g) ?? []) {
        expect(heredoc, `${label}: unquoted heredoc`).toMatch(/^<<'EOF'$/);
      }
      expect(body, `${label}: command substitution in an argument`).not.toMatch(/-m "\$\(/);
    });
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
        .filter((invocation) => /<<'EOF'$|\s-m |\s--file /.test(invocation));

    it.each(installedSkills)("$label names no lock mechanism at all", ({ label, body }) => {
      expect(body, `${label}: names a lock verb`).not.toMatch(/corpus lock\b/);
      expect(body, `${label}: teaches an edit lock`).not.toMatch(/edit lock/i);
      expect(body, `${label}: teaches lock breaking`).not.toMatch(
        /break(?:ing)? a lock|force a lock/i,
      );
      expect(body, `${label}: teaches lock recovery`).not.toMatch(/reap(?:s|ed|ing)? .{0,20}lock/i);
      // `423` was the lock's refusal on every write route; a `409` replaced it.
      expect(body, `${label}: names the lock's status code`).not.toMatch(/\b423\b/);
    });

    it.each(installedSkills)("$label replaces no body without a key", ({ label, body }) => {
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
    it.each(skills)("$name teaches the revert as a loop, not a verb", ({ relPath }) => {
      const body = documentAt(relPath).body;
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

    it.each(skills)("$name reads git and never writes to it", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
      expect(flat).toMatch(/read from git, never write to it/i);
      for (const verb of ["git log", "git show", "git checkout", "git restore", "git commit"]) {
        expect(flat, `does not name \`${verb}\``).toContain(`\`${verb}\``);
      }
      expect(flat).toMatch(/sole writer/i);
      // The frontmatter trap: the file in git is not the body the write takes.
      expect(flat).toMatch(/whole file.{0,80}(?:body|write)|body.{0,80}whole file/i);
      expect(flat).toMatch(/closing `---`/);
    });

    it.each(skills)("$name says what makes a revert safe", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
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

    it.each(skills)("$name reverts a passage with a patch", ({ relPath }) => {
      const flat = documentAt(relPath).body.replace(/\s+/g, " ");
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
    expect(sections.size).toBe(16);
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
      '{"idle":true,"reason":"timeout"}',
      '{"idle":true,"reason":"halted"}',
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
   * AGENT-015, SPEC.md §7 and §11 (rider SHARED-022, signed 2026-08-06). The
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
      //   - **The server and the plugins.** AGENT-015's criterion is about the
      //     product, not about the two workspaces the guard happened to name;
      //     `apps/server/src` routes the weight and `plugins/` is shipped v1
      //     code with composers of its own.
      //   - **No exemption for a published directory.** `@corpus/kit/testing`
      //     is a subpath plugin authors can import, so what sits in it ships
      //     whatever its name says; the assertion below pins that it is scanned.
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
        "plugins",
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
     * must be absent from every installed skill, plugin skills included. The
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
      expect(body).toMatch(/corpus doc edit doc_7e3a91 --key [0-9a-f]{64} --from agent <<'EOF'/);
      // It ends in an entry, not in a thread: the read that makes an append
      // possible, the write that carries it, and a job log saying so. The
      // append is the keyed whole-body write, and the key it presents must be
      // the one that read printed — a worked example that presented any other
      // key would teach the one mistake AGENT-022 exists to prevent.
      const append =
        /corpus doc show doc_a1b2c3\nkey ([0-9a-f]{64})\ncorpus doc edit doc_a1b2c3 --key ([0-9a-f]{64}) --from agent <<'EOF'\n([\s\S]*?)\nEOF/.exec(
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
     * AGENT-020, SPEC §5/§7/§11's rider signed 2026-08-07. Noticing writes an
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
      // The launch, and the three things a subagent cannot inherit.
      expect(routing).toMatch(/\*\*Launching a listener\.\*\*/);
      expect(routing).toMatch(/invoked as `\/converse <the payload's threadId>`/);
      expect(routing).toMatch(/the `agent-def` document id both/);
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
      expect(routing).toMatch(/\*\*A lane that already has a listener gets nothing\.\*\*/);
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
    expect(sections.size).toBe(13);
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
    it("carries the prohibition in no form, nor the hazard that motivated it", () => {
      expect(body).not.toMatch(/Do not resolve on the person's behalf/i);
      expect(body).not.toMatch(/only when they asked for the matter to be closed/i);
      // SERVER-062 made this false. It is the sentence that made the ban look
      // right, so it may not survive the ban.
      expect(body).not.toMatch(/resolved unilaterally/i);
      expect(body).not.toMatch(/stops\s+waking you/i);
    });

    it("states the trigger as four conditions holding at once", () => {
      expect(body).toMatch(/\*\*Close what you asked for and got\.\*\*/);
      expect(body).toMatch(/all four of these\s+hold at once/);
      expect(body).toMatch(/you asked the person for feedback or information/);
      expect(body).toMatch(/they \*\*provided it\*\* — a turn of their own in the thread/);
      expect(body).toMatch(/you have \*\*used\*\* it/);
      expect(body).toMatch(/nothing in the thread is still waiting on anyone/);
      // Authorship is deliberately not among them: keying the permission to it
      // would forbid the commonest real shape and permit almost nothing else.
      expect(body).toMatch(/Who opened the thread is irrelevant/);
      expect(body).toMatch(/they ask,\s+you need one clarification, they clarify, you finish/);
    });

    it("names all four exclusions, each as a rule rather than a call", () => {
      expect(body).toMatch(/\*\*Four threads you never close\*\*, each a rule rather than a call/);
      expect(body).toMatch(/\*\*A thread the person never replied to\.\*\*/);
      expect(body).toMatch(/no amount of elapsed time turns silence into an answer/);
      expect(body).toMatch(/\*\*A thread holding an unanswered form\.\*\*/);
      // Not qualified by how many of the thread's forms did come back.
      expect(body).toMatch(/however many of\s+its other forms came back/);
      expect(body).toMatch(/\*\*An unfinished piece of your own work\.\*\*/);
      expect(body).toMatch(/marking your own homework done/);
      expect(body).toMatch(/\*\*A question the person put to you that you have not yet answered/);
      // The one case that is neither permitted nor forbidden keeps its old
      // instruction rather than falling through the gap between the two lists.
      expect(body).toMatch(/\*\*suggest resolving\*\* and leave the control with them/);
    });

    it("rides the resolve on a reply turn that says so in words", () => {
      expect(body).toMatch(/\*\*The resolve rides on the reply that reports the work\.\*\*/);
      expect(body).toMatch(/never a resolve with no readable turn attached/);
      // The rule is that there is a turn — not which command runs first, which
      // the author's own reply not reopening its thread makes immaterial.
      expect(body).toMatch(/Which of the two commands runs first changes nothing/);
      expect(body).toMatch(/that there \*\*is\*\* a turn changes everything/);
      // Why a silent resolve is not merely terse: with SHARED-018's collapse it
      // is a conversation that folds away unread.
      expect(body).toMatch(/the board collapses\s+a resolved thread holding nothing unseen/);
      expect(body).toMatch(/state the closing in the prose, in words/);
      // Practised, not only stated: one reply, one resolve, same act.
      expect(body).toContain("corpus thread resolve th_4b8e2c --from agent");
      expect(body).toContain("so I'm closing this thread");
      // The state change goes on the trace line rather than inventing a second
      // convention for reporting it.
      expect(body).toMatch(
        /↳ updated the rate assumption in \[\[doc_a1b2c3\]\] to 6\.4%; resolved/,
      );
    });

    it("states the reopen rule in both directions", () => {
      expect(body).toMatch(/\*\*Resolved is a closed door, not a locked one\.\*\*/);
      expect(body).toMatch(/sets it back to `open` in the same write that appends it/);
      expect(body).toMatch(/that reply reaches you again with no\s+`@agent` needed/);
      expect(body).toMatch(/A turn\s+\*\*you\*\* write reopens nothing/);
      // Stated as what resolving costs, because an agent that believes closing
      // is final closes nothing.
      expect(body).toMatch(/one reply restores the conversation/);
    });

    it("cascades nowhere and treats a second resolve as a no-op", () => {
      expect(body).toMatch(/\*\*Resolving cascades nowhere\.\*\*/);
      expect(body).toMatch(/closing\s+a subthread leaves its parent open/);
      expect(body).toMatch(/closing a parent leaves its children open/);
      expect(body).toMatch(/prints\s+"already resolved" and changes nothing/);
      expect(body).toMatch(/not an error/);
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
    expect(body).toMatch(/corpus thread reply th_\w+ --from agent --model \S+ <<'EOF'/);
    expect(body).toMatch(/Never post a reply by editing the thread file/i);
    expect(body).toMatch(/Always reply/i);
    expect(body).toMatch(/pending indicator/i);
    expect(body).toContain("[[id]]");
    expect(body).toMatch(/Length follows the work/i);
  });

  it("files the inbox concretely and names its convention", () => {
    expect(body).toContain("data/docs/inbox/");
    expect(body).toContain("corpus doc move <id> --folder finance --from agent");
    expect(body).toContain("--add-tag");
    expect(body).toMatch(/prefer\s+one that already holds similar documents/i);
    expect(body).toMatch(/leave it in `inbox\/` and ask/i);
    expect(body).toMatch(/Expansion adds structure, never content/i);
  });

  /**
   * Forms (AGENT-017, SPEC.md §6 + §7's "asking with a form" rider signed
   * 2026-08-05). CONTRACT-038 and UI-084 made a form worth reaching for; this
   * section is the only thing that makes the agent reach for one, so what is
   * pinned here is the *instruction* — ask with a form, batch the questions —
   * and not merely the presence of the word "form".
   */
  describe("forms", () => {
    /** The worked ```` ```form ```` example, which is a real multi-field ask. */
    const example = fencedBlocks(body).find((block) => block.info === "form");

    it("makes a form the default shape for a turn whose purpose is to ask", () => {
      expect(body).toMatch(/When a turn's purpose is to get something from the person, ask with/);
      // The asymmetry that is the whole reason to prefer one (SPEC.md §11):
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
      expect(body).toMatch(/required unless it\s+carries `optional: true`/);
      expect(body).toMatch(/Mark generously/);
      expect(body).toMatch(/more optional fields, never fewer forms/i);
      expect(body).toMatch(/short enough to read as a control/i);
      expect(body).toMatch(/what you will do with the answers/i);
    });

    it("documents the three kinds and shows a genuinely multi-field example", () => {
      expect(body).toContain("```form\nfields:\n");
      expect(body).toContain("kind: choose one");
      expect(body).toContain("kind: choose any");
      expect(body).toContain("kind: write");
      expect(body).toContain("optional: true");
      expect(body).toContain("options:");
      expect(body).not.toContain("~~~");
      expect(body).toMatch(/there is no fourth kind/i);
      expect(body).toMatch(/distinct within the\s+form/i);
      expect(body).toMatch(/at most one form per\s+turn/i);
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
      expect(body).not.toMatch(/nothing validates the block when it is posted/i);
      expect(body).toMatch(/the server refuses the whole turn with a `400`/i);
      // `choose any` exists, so the answer is no longer one option verbatim.
      expect(body).not.toMatch(/single-select/i);
    });

    it("states that the agent never answers a form, including its own", () => {
      expect(body).toMatch(/You never answer a form — not the person's, and not your own/);
      expect(body).toMatch(/the server refuses an answer from you/i);
    });

    it("resumes from the richer payload, keyed to the questions", () => {
      for (const field of ["formTs", "answers", "question", "kind", "option", "note"]) {
        expect(body, `form.respond field ${field} unnamed`).toContain(field);
      }
      expect(body).toMatch(/no\s+`parentId`/i);
      expect(body).toMatch(/continuation, not a new request/i);
      expect(body).toMatch(/never re-ask, never re-explain from the top/i);
      expect(body).toMatch(/keyed to its question/i);
      // The two answers that are easy to mishandle: a blank optional field is a
      // complete answer, and a prose reply is not an answer at all.
      expect(body).toMatch(/Every optional field left blank is a \*\*complete\*\* answer/);
      expect(body).toMatch(/never resolve the thread to make the row go\s+away/);
    });
  });

  it("states skill genesis: threshold, destination, mechanism, announcement, conflicts", () => {
    expect(body).toMatch(/stated more than once/i);
    // Extend-first stays the default; creation is for when nothing fits.
    expect(body).toMatch(/Extend an existing skill when one fits/i);
    expect(body).toMatch(/Create a genuinely new skill when nothing installed fits/i);
    // AGENT-006: the creation branch names the shipped verb (CLI-011), and the
    // propose-a-note path is gone — one documented way, not two.
    expect(body).toContain('corpus skill create <name> --description "<one line>" --from agent');
    expect(body).not.toMatch(/Propose a genuinely new skill/i);
    expect(body).not.toMatch(/cannot write into `\.claude\/`/i);
    expect(body).toMatch(/an \*\*edit to that\s+skill\*\*, never a second skill/i);
    expect(body).toMatch(/Announce it in the reply/i);
    expect(body).toMatch(/\*\*next\*\* run of the loop/i);
  });

  it("states what the server owns about skill creation, as outcomes not pre-checks", () => {
    // TEST-411/412/413: name grammar, install/archive collision with the right
    // recovery, required description, dual frontmatter, and the ways back.
    expect(body).toMatch(/lowercase letters, digits and single hyphens, at most 64 characters/);
    expect(body).toContain("`400`");
    expect(body).toMatch(/installed \*\*or archived\*\* is a `409`/);
    expect(body).toMatch(/`409` means unarchive it/);
    expect(body).toMatch(/`--description` is required/);
    expect(body).toContain(".claude/skills/<name>/SKILL.md");
    expect(body).toMatch(/\*\*both\*\* frontmatter vocabularies\s+written by the server/i);
    // SHARED-042: the ways back are the ordinary ones. Archiving disables a
    // skill; a wording it regrets is reverted the way any document is, so the
    // branch points at the revert loop rather than at a verb that no longer
    // exists.
    expect(body).toMatch(/read the history, write the old text back with the key/i);
    expect(body).toMatch(/corpus doc archive/);
    expect(body).toMatch(/do not pre-check/i);
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

  it("routes plugin-domain work to the plugin's skill, naming no plugin", () => {
    expect(body).toContain(".claude/skills/<plugin>/");
    expect(body).toMatch(/never edit a\s+plugin's documents field by field/i);
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
    const examples = body.split("\n").filter((line) => /^\*\*\d+ — /.test(line));
    expect(examples).toHaveLength(4);
    expect(body).toMatch(/\*\*1 — Anchored comment/);
    expect(body).toMatch(/\*\*2 — Standalone Ask/);
    expect(body).toMatch(/\*\*3 — Inbox capture/);
    expect(body).toMatch(/\*\*4 — A `form\.respond` continuation/);
  });

  it("does not restate the orchestrate skill's loop", () => {
    expect(body).not.toMatch(/corpus queue (?:claim-all|idle|halt|resume|reap-stale)/);
    expect(body).not.toContain(".corpus/HALT");
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
    for (const heredoc of heredocs) expect(heredoc).toMatch(/^<<'EOF'$/);
    expect(body).not.toMatch(/-m "\$\(/);
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
      // The asymmetry that makes a variable worse here than elsewhere.
      expect(body).toMatch(
        /a wrong `CORPUS_JOB` is refused, but a wrong lane is honoured in\s+silence/,
      );
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
    expect(body).toMatch(/\*\*Never re-park on a dissolved lane\.\*\*/);
    // The exact failure: the park is accepted, so a skipped check waits forever.
    expect(body).toMatch(/accepted and parks; it does not error/);
    expect(body).toMatch(/waits forever\s+on a conversation that no longer has it/);
    // A sign-off on an open thread, nothing on a resolved one.
    expect(body).toMatch(/\*\*If it is resolved, post nothing\.\*\*/);
    expect(body).toMatch(/Reopening a resolved thread later does not bring you back/);
    // Measured in the live drill: a release landed while the listener was
    // parked and was read at the top of the next pass, one rearm later. That
    // latency is stated as correct so it does not get "fixed" with a poll.
    expect(body).toMatch(/\*\*Finding out one rearm late is correct, not a gap\.\*\*/);
    expect(body).toMatch(/every message written in between was\s+stamped for the orchestrator/);
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
    // Work in one lane is one conversation, so it is serial by construction.
    expect(body).toMatch(/in claim order, one at a time/);
    expect(body).toMatch(/There is no overlap set to compute here/);
    // Halted is quiet, not an exit.
    expect(body).toContain('{"idle":true,"reason":"halted"}');
    expect(body).toContain('{"idle":true,"reason":"timeout"}');
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
    for (const heredoc of heredocs) expect(heredoc).toMatch(/^<<'EOF'$/);
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

  it("spells no undocumented flag in a plugin's skill either", () => {
    for (const { label, body } of installedSkills) {
      expect(undocumentedFlagsIn(body), label).toEqual([]);
    }
  });

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
