import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { computeContext } from "./context.js";
import { reconcileAnchors } from "./reconcile.js";
import { resolveAnchor } from "./resolve.js";
import type { ReconcileReport, TextQuoteSelector } from "./types.js";

/**
 * The §15 M1 matrix run for real: an actual markdown file with an `anchors:`
 * frontmatter block on an actual disk, edited, reconciled, written back, and
 * re-read — the engine stays pure; the test plays the server's save path.
 * (Sprint-001 TEST-22…TEST-26; TEST-26 with the contract's Given — the words
 * on both sides of the anchored sentence rewritten.)
 */

const SENT = "We assume a 30-year fixed at 6.1% for the base case.";
const PRE = "The finance model has three inputs that matter most.";
const POST = "Everything downstream depends on that number.";
const BODY = `\n# Mortgage options\n\n${PRE}\n\n${SENT}\n\n${POST}\n`;
const ANCHOR_ID = "anc_k4f7";

type Frontmatter = { id: string; type: string; anchors: Record<string, TextQuoteSelector> };

const workspace = mkdtempSync(join(tmpdir(), "corpus-m1-"));
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const readDoc = (file: string): { frontmatter: Frontmatter; body: string } => {
  const match = /^---\n([\s\S]*?)---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  if (match?.[1] === undefined || match[2] === undefined) throw new Error("malformed document");
  return { frontmatter: parse(match[1]) as Frontmatter, body: match[2] };
};

const writeDoc = (file: string, frontmatter: Frontmatter, body: string): void => {
  writeFileSync(file, `---\n${stringify(frontmatter)}---\n${body}`);
};

/** Seed a document, apply the edit, reconcile from what is on disk, write back, re-read. */
const runRow = (
  name: string,
  edit: (body: string) => string,
): { report: ReconcileReport; selector: TextQuoteSelector; body: string } => {
  const file = join(workspace, `${name}.md`);
  const start = BODY.indexOf(SENT);
  const seeded: Frontmatter = {
    id: "doc_a1b2c3",
    type: "note",
    anchors: { [ANCHOR_ID]: { exact: SENT, ...computeContext(BODY, start, start + SENT.length) } },
  };
  writeDoc(file, seeded, BODY);

  const { frontmatter, body } = readDoc(file);
  const newBody = edit(body);
  const { anchors, report } = reconcileAnchors(body, newBody, frontmatter.anchors);
  writeDoc(file, { ...frontmatter, anchors }, newBody);

  const persisted = readDoc(file);
  const selector = persisted.frontmatter.anchors[ANCHOR_ID];
  if (selector === undefined) throw new Error("anchor lost on disk");
  return { report, selector, body: persisted.body };
};

describe("M1 matrix on disk", () => {
  it("edit strictly before the range → anchor survives, exact byte-identical on disk", () => {
    const { report, selector, body } = runRow("before", (b) =>
      b.replace("# Mortgage options", "# Mortgage options\n\nA new paragraph goes on top."),
    );
    expect(report.orphaned).toEqual([]);
    expect(selector.exact).toBe(SENT);
    const range = resolveAnchor(body, selector);
    expect(body.slice(range?.start, range?.end)).toBe(SENT);
  });

  it("edit strictly after the range → unchanged, selector untouched on disk", () => {
    const { report, selector } = runRow("after", (b) => `${b}\nAppended far below.\n`);
    expect(report).toEqual({ unchanged: [ANCHOR_ID], remapped: [], orphaned: [] });
    expect(selector.exact).toBe(SENT);
  });

  it("edit inside the range → remapped, on-disk exact quotes the edited sentence", () => {
    const { report, selector, body } = runRow("inside", (b) => b.replace("6.1%", "6.4%"));
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    expect(selector.exact).toBe(SENT.replace("6.1%", "6.4%"));
    const range = resolveAnchor(body, selector);
    expect(body.slice(range?.start, range?.end)).toBe(selector.exact);
  });

  it("range deleted → orphaned, selector preserved byte-for-byte on disk", () => {
    const start = BODY.indexOf(SENT);
    const original = { exact: SENT, ...computeContext(BODY, start, start + SENT.length) };
    const { report, selector } = runRow("deleted", (b) => b.replace(`${SENT}\n\n`, ""));
    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: [ANCHOR_ID] });
    expect(selector).toEqual(original);
  });

  it("TEST-26: both neighbouring sentences rewritten → remapped, exact kept, context quotes the new surroundings", () => {
    const { report, selector, body } = runRow("context-only", (b) =>
      b
        .replace(PRE, "Completely different words now precede the quoted line here.")
        .replace(POST, "Utterly different words now follow the quoted line as well."),
    );
    expect(report).toEqual({ unchanged: [], remapped: [ANCHOR_ID], orphaned: [] });
    expect(selector.exact).toBe(SENT);
    // Context on disk quotes the *new* surroundings, within the engine's window.
    const start = body.indexOf(SENT);
    expect({ prefix: selector.prefix, suffix: selector.suffix }).toEqual(
      computeContext(body, start, start + SENT.length),
    );
    expect(body.includes(selector.prefix + selector.exact + selector.suffix)).toBe(true);
    const range = resolveAnchor(body, selector);
    expect(body.slice(range?.start, range?.end)).toBe(SENT);
  });
});
