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
    // except the two skills, whose AGENT-002/AGENT-003 bodies advanced it — the
    // template's own "updated tracks content" rule, applied to itself.
    expect(new Set(documents.map(({ frontmatter }) => frontmatter.created)).size).toBe(1);
    const rewritten = ["claude/skills/orchestrate/SKILL.md", "claude/skills/comment/SKILL.md"];
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
            "delegation",
            "user edit",
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

  it("defers on a user lock with the defer verb; the deferred:-prefix protocol is gone", () => {
    // AGENT-007 / SPEC §7 as signed 2026-07-30: a deferral is the defer
    // transition, never a `deferred:`-prefixed failure. The prefix survives
    // nowhere — not as an instruction, an example, or an explanation.
    expect(body).not.toMatch(/deferred:/);
    expect(body).not.toMatch(/retry the job from the console/i);
    // Reply first (a person watches a pending indicator), then defer, with
    // `--blocked-on` naming the locked document.
    expect(body).toMatch(
      /# nothing changed, so that reply carries no trace line\ncorpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3/,
    );
    expect(body).toMatch(/names the \*\*locked document\*\*/);
    expect(body).toMatch(/parks forever/);
    // A deferral is not a failure, and the status carries the meaning.
    expect(body).toMatch(/under\s+`deferred`, never\s+`failed`/);
    // Automatic re-entry: all three lock-clearing triggers, the parked idle
    // unparking, and `corpus job retry` demoted to the by-hand override.
    expect(body).toMatch(/\*\*released\*\*,\s+\*\*force-broken\*\*, or\s+\*\*reaped\*\*/);
    expect(body).toMatch(/returns the event to `pending` by itself/);
    expect(body).toMatch(/parked `corpus queue idle` unparks/);
    expect(body).toMatch(/`corpus job retry` remains only as the by-hand override/);
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
    // A blocked subagent defers through the orchestrator, never fails.
    expect(body).toMatch(/\*\*A blocked subagent defers — through you\.\*\*/);
  });

  it("scales the subagent model with task weight, naming Opus 5 in the mix", () => {
    expect(body).toMatch(/\*\*Opus 5\*\*/);
    expect(body).toMatch(/\*\*Haiku\*\*/);
    expect(body).toMatch(/\*\*Sonnet\*\*/);
    // The guidance is executable: a decision rule, not a decoration.
    expect(body).toMatch(/Judge weight by three things/);
    expect(body).toMatch(/take the stronger/);
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
      // Commenting is the default; updating is the entailed-correction case.
      expect(body).toMatch(/lean to commenting/i);
      expect(body).toMatch(/mechanical and entailed/);
      expect(body).toMatch(/Stop at three documents/);
    });

    it("acknowledges with a whole-document thread and says why that surface", () => {
      expect(body).toMatch(
        /corpus thread create --parent doc_a1b2c3 --from agent`, no `--quote`, no `--requests-agent`/,
      );
      expect(body).toMatch(/takes no edit lock, writes no anchor/);
      expect(body).toMatch(/One\s+acknowledgment per session, never a second/);
      expect(body).toMatch(/A trivial edit gets none of this/);
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
      expect(body).toMatch(/corpus doc edit doc_7e3a91 --from agent <<'EOF'/);
      expect(body).toMatch(/↳ updated the rate assumption in \[\[doc_7e3a91\]\] to 6\.4%/);
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

    it("keeps the loop one literal bash block that names the reconciliation step", () => {
      const loop = body.slice(body.indexOf("## The loop"), body.indexOf("## Claiming"));
      const blocks = fencedBlocks(loop);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.info).toBe("bash");
      expect(blocks[0]?.content).toMatch(/reconcile that held list against your own work/);
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
      "corpus skill rollback",
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
    expect(body).toMatch(/Do not resolve on the person's behalf/i);
  });

  it("defers on a user lock without naming a queue verb", () => {
    expect(body).toContain("423");
    expect(body).toMatch(/Do not retry, and do not break the lock/i);
    // The job-log line carries no `deferred:` prefix — the defer status says
    // that now (AGENT-007) — and the dead protocol survives nowhere.
    expect(body).toContain(
      'corpus job log evt_7c1d9a "waiting on [[doc_a1b2c3]] — the user holds its edit lock"',
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
    expect(body).toMatch(/corpus thread reply th_\w+ --from agent <<'EOF'/);
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
    expect(body).toMatch(/corpus skill rollback <name>/);
    expect(body).toMatch(/corpus doc archive/);
    expect(body).toMatch(/do not pre-check/i);
  });

  it("bounds stewardship and forbids deletion", () => {
    expect(body).toMatch(/leave it better than you\s+found it/i);
    expect(body).toMatch(/Archive, never delete/i);
    expect(body).toMatch(/deletion is the user's alone/i);
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
      /corpus skill rollback <name>/,
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
