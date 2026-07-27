import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeContext } from "../anchors/index.js";
import { parseDocument } from "../core/index.js";
import { createLogger, silentLogger, type LogSink } from "../logger.js";
import { reconcileOutOfBandEdit } from "./reconcile-out-of-band.js";
import { createSelfWriteRegistry } from "./self-writes.js";

const RELATIVE = "data/docs/finance/mortgage.md";

const BODY = [
  "",
  "# Mortgage",
  "",
  "The model we assume a 30-year fixed at 6.1% which may be stale.",
  "",
  "Unrelated closing paragraph.",
  "",
].join("\n");

const EXACT = "assume a 30-year fixed at 6.1%";

/**
 * The selector as the write path would have written it: `exact` plus the §6
 * context window computed from the body it was anchored in. Spelling it out by
 * hand would make every "unchanged" assertion below a lie, because a shorter
 * context is itself a difference the reconciler corrects.
 */
function selectorFor(body: string, exact: string): { prefix: string; suffix: string } {
  const start = body.indexOf(exact);
  return computeContext(body, start, start + exact.length);
}

function anchorsBlock(body: string, exact: string): string {
  const { prefix, suffix } = selectorFor(body, exact);
  return [
    "anchors:",
    "  anc_k4f7:",
    `    exact: ${JSON.stringify(exact)}`,
    `    prefix: ${JSON.stringify(prefix)}`,
    `    suffix: ${JSON.stringify(suffix)}`,
  ].join("\n");
}

const ANCHORS = anchorsBlock(BODY, EXACT);

const documentWith = (body: string, anchors = ANCHORS): string =>
  ["---", "id: doc_mortgage", "type: note", "title: Mortgage", anchors, "---", body].join("\n");

let root: string;
let workspace: string;
let absPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s007-oob-"));
  workspace = join(root, "ws");
  absPath = join(workspace, ...RELATIVE.split("/"));
  mkdirSync(dirname(absPath), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: workspace, stdio: ["ignore", "ignore", "ignore"] });
}

function initRepo(): void {
  git("init", "-q");
}

function commitAll(): void {
  git("add", "-A");
  git(
    "-c",
    "user.email=test@corpus.local",
    "-c",
    "user.name=Corpus Test",
    "commit",
    "-q",
    "-m",
    "seed",
  );
}

function reconcile(overrides: { logger?: ReturnType<typeof createLogger> } = {}) {
  const selfWrites = createSelfWriteRegistry();
  const outcome = reconcileOutOfBandEdit({
    workspaceRoot: workspace,
    absPath,
    relativePath: RELATIVE,
    content: readFileSync(absPath, "utf8"),
    selfWrites,
    logger: overrides.logger ?? silentLogger,
  });
  return { outcome, selfWrites };
}

const anchorsOnDisk = (): unknown => parseDocument(readFileSync(absPath, "utf8")).data["anchors"];

describe("reconcileOutOfBandEdit", () => {
  it("remaps a selector whose sentence was rewritten on disk", () => {
    writeFileSync(absPath, documentWith(BODY), "utf8");
    initRepo();
    commitAll();
    writeFileSync(absPath, documentWith(BODY.replace("6.1%", "6.4%")), "utf8");

    const { outcome, selfWrites } = reconcile();

    expect(outcome.kind).toBe("reconciled");
    expect(outcome.kind === "reconciled" && outcome.report.remapped).toEqual(["anc_k4f7"]);
    const newBody = BODY.replace("6.1%", "6.4%");
    expect(anchorsOnDisk()).toEqual({
      anc_k4f7: {
        exact: "assume a 30-year fixed at 6.4%",
        ...selectorFor(newBody, "assume a 30-year fixed at 6.4%"),
      },
    });
    // The write-back is registered so the watcher does not treat it as a new
    // out-of-band edit and reconcile forever.
    expect(selfWrites.claim(absPath, readFileSync(absPath))).toBe(true);
  });

  it("orphans an anchor whose text was deleted, keeping its last selector", () => {
    writeFileSync(absPath, documentWith(BODY), "utf8");
    initRepo();
    commitAll();
    writeFileSync(
      absPath,
      documentWith(
        BODY.replace("The model we assume a 30-year fixed at 6.1% which may be stale.", "Gone."),
      ),
      "utf8",
    );

    const { outcome } = reconcile();

    // An orphan keeps its last selector byte-for-byte (SPEC.md §6 step 5), so
    // there is nothing to write back — the file is left exactly as the editor
    // saved it.
    expect(outcome).toEqual({
      kind: "unchanged",
      report: { unchanged: [], remapped: [], orphaned: ["anc_k4f7"] },
    });
    expect(anchorsOnDisk()).toEqual({
      anc_k4f7: { exact: EXACT, ...selectorFor(BODY, EXACT) },
    });
  });

  it("rewrites nothing when the edit left every selector describing its text", () => {
    writeFileSync(absPath, documentWith(BODY), "utf8");
    initRepo();
    commitAll();
    // An edit far from the anchor: the range is untouched and its 32-unit
    // context window is unchanged, so the file must not be rewritten at all.
    const before = documentWith(`${BODY}\nA new trailing paragraph.\n`);
    writeFileSync(absPath, before, "utf8");

    const { outcome, selfWrites } = reconcile();

    expect(outcome.kind).toBe("unchanged");
    expect(readFileSync(absPath, "utf8")).toBe(before);
    expect(selfWrites.size).toBe(0);
  });

  it.each([
    [
      "a document with no anchors",
      () => {
        writeFileSync(absPath, "---\nid: doc_mortgage\n---\n\nBody.\n", "utf8");
        initRepo();
        commitAll();
        writeFileSync(absPath, "---\nid: doc_mortgage\n---\n\nEdited.\n", "utf8");
      },
      "no anchors",
    ],
    [
      "an empty anchors map",
      () => {
        writeFileSync(absPath, "---\nid: doc_mortgage\nanchors: {}\n---\n\nBody.\n", "utf8");
        initRepo();
        commitAll();
        writeFileSync(absPath, "---\nid: doc_mortgage\nanchors: {}\n---\n\nEdited.\n", "utf8");
      },
      "no anchors",
    ],
    [
      "an untracked document",
      () => {
        writeFileSync(absPath, documentWith(BODY), "utf8");
        initRepo();
        // Nothing committed: `git show HEAD:` has no HEAD to read.
      },
      "no committed version",
    ],
    [
      "a workspace that is not a repository",
      () => {
        writeFileSync(absPath, documentWith(BODY), "utf8");
      },
      "no committed version",
    ],
    [
      "a body identical to the committed one",
      () => {
        writeFileSync(absPath, documentWith(BODY), "utf8");
        initRepo();
        commitAll();
        // Frontmatter-only change: the body the anchors describe is untouched.
        writeFileSync(
          absPath,
          documentWith(BODY).replace("title: Mortgage", "title: Mortgage!"),
          "utf8",
        );
      },
      "body unchanged",
    ],
    [
      "a file whose frontmatter does not parse",
      () => {
        writeFileSync(absPath, documentWith(BODY), "utf8");
        initRepo();
        commitAll();
        writeFileSync(absPath, "no frontmatter here\n", "utf8");
      },
      "unparseable",
    ],
  ])("skips %s", (_label, arrange, reason) => {
    arrange();
    const before = readFileSync(absPath, "utf8");

    const { outcome } = reconcile();

    expect(outcome).toEqual({ kind: "skipped", reason });
    expect(readFileSync(absPath, "utf8")).toBe(before);
  });

  it("leaves a malformed anchors block exactly as it is, and says why", () => {
    const malformed = documentWith(BODY, "anchors:\n  anc_k4f7: not-a-selector");
    writeFileSync(absPath, malformed, "utf8");
    initRepo();
    commitAll();
    const edited = documentWith(
      BODY.replace("6.1%", "6.4%"),
      "anchors:\n  anc_k4f7: not-a-selector",
    );
    writeFileSync(absPath, edited, "utf8");

    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const { outcome } = reconcile({ logger: createLogger("info", sink) });

    expect(outcome).toEqual({ kind: "skipped", reason: "malformed anchors" });
    // Rewriting would silently drop the entries that did not parse.
    expect(readFileSync(absPath, "utf8")).toBe(edited);
    expect(lines.join("\n")).toContain("malformed anchors block");
  });

  it("skips when the committed version is not a parseable document", () => {
    writeFileSync(absPath, "no frontmatter\n", "utf8");
    initRepo();
    commitAll();
    writeFileSync(absPath, documentWith(BODY.replace("6.1%", "6.4%")), "utf8");

    const { outcome } = reconcile();

    expect(outcome).toEqual({ kind: "skipped", reason: "committed version unparseable" });
  });

  it("touches only the anchors block, leaving the rest of the frontmatter byte-identical", () => {
    const original = [
      "---",
      "id: doc_mortgage",
      "type:    note",
      "tags: [ finance,  home ]   # spaced on purpose",
      "title: Mortgage",
      ANCHORS,
      "---",
      BODY,
    ].join("\n");
    writeFileSync(absPath, original, "utf8");
    initRepo();
    commitAll();
    writeFileSync(
      absPath,
      original.replace("6.1% which may be stale.", "6.4% as of today."),
      "utf8",
    );

    reconcile();

    const after = readFileSync(absPath, "utf8");
    expect(after).toContain("type:    note");
    expect(after).toContain("tags: [ finance,  home ]   # spaced on purpose");
    expect(after).toContain("6.4%");
  });

  it("leaves no temp file behind when the write-back cannot land", () => {
    writeFileSync(absPath, documentWith(BODY.replace("6.1%", "6.4%")), "utf8");
    const directory = dirname(absPath);
    chmodSync(directory, 0o500);

    try {
      expect(() =>
        reconcileOutOfBandEdit({
          workspaceRoot: workspace,
          absPath,
          relativePath: RELATIVE,
          content: readFileSync(absPath, "utf8"),
          selfWrites: createSelfWriteRegistry(),
          readHead: () => documentWith(BODY),
        }),
      ).toThrow();
      expect(readdirSync(directory)).toEqual(["mortgage.md"]);
    } finally {
      chmodSync(directory, 0o700);
    }
  });

  it("uses an injected HEAD reader, so the engine never depends on a real repository", () => {
    writeFileSync(absPath, documentWith(BODY.replace("6.1%", "6.4%")), "utf8");
    const selfWrites = createSelfWriteRegistry();

    const outcome = reconcileOutOfBandEdit({
      workspaceRoot: workspace,
      absPath,
      relativePath: RELATIVE,
      content: readFileSync(absPath, "utf8"),
      selfWrites,
      readHead: () => documentWith(BODY),
    });

    expect(outcome.kind).toBe("reconciled");
    expect(anchorsOnDisk()).toMatchObject({
      anc_k4f7: { exact: "assume a 30-year fixed at 6.4%" },
    });
  });
});
