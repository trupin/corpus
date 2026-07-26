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

  it("TEST-25 extended: deleted bullet with near-identical siblings → orphaned, selector byte-identical on disk", () => {
    // Evaluator round-2 (FAIL-2): a similar sibling must not "verify" the
    // deleted bullet as surviving — the anchor block on disk must not change.
    const bullet = (item: string) => `- Buy ${item} from the corner store on Tuesday.`;
    const body = `\n# Shopping\n\n${bullet("milk")}\n${bullet("bread")}\n${bullet("eggs")}\n`;
    const at = body.indexOf(bullet("bread"));
    const seeded: Frontmatter = {
      id: "doc_d4e5f6",
      type: "note",
      anchors: {
        anc_bread1: {
          exact: bullet("bread"),
          ...computeContext(body, at, at + bullet("bread").length),
        },
      },
    };
    const file = join(workspace, "bullets.md");
    writeDoc(file, seeded, body);
    const seededRaw = readFileSync(file, "utf8");

    const { frontmatter, body: onDisk } = readDoc(file);
    const newBody = onDisk.replace(`${bullet("bread")}\n`, "");
    const { anchors, report } = reconcileAnchors(onDisk, newBody, frontmatter.anchors);
    writeDoc(file, { ...frontmatter, anchors }, newBody);

    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_bread1"] });
    const persistedRaw = readFileSync(file, "utf8");
    // The whole persisted file differs from the seeded one only by the deleted
    // body line — the anchor's frontmatter block is untouched byte-for-byte.
    expect(persistedRaw).toBe(seededRaw.replace(`${bullet("bread")}\n`, ""));
    expect(readDoc(file).frontmatter.anchors["anc_bread1"]).toEqual(seeded.anchors["anc_bread1"]);
  });

  it("SERVER-012: deleting a paragraph beside its edited near-identical sibling never truncates selectors on disk", () => {
    // Pre-fix, this write persisted `exact: Paragraph one now has orang` (a
    // mid-word truncation) and handed anc_two2 the surviving paragraph's text.
    // Fixed: neither original survives verbatim, so both anchors orphan and
    // the persisted file differs from the seeded one by the body edit alone.
    const p1 = "Paragraph one now has apples and pears in the basket today.";
    const p2 = "Paragraph two now has apples and pears in the basket today.";
    const body = `\n# Doc\n\n${p1}\n\n${p2}\n\nA closing paragraph that stays put.\n`;
    const at1 = body.indexOf(p1);
    const at2 = body.indexOf(p2);
    const seeded: Frontmatter = {
      id: "doc_s012aa",
      type: "note",
      anchors: {
        anc_one1: { exact: p1, ...computeContext(body, at1, at1 + p1.length) },
        anc_two2: { exact: p2, ...computeContext(body, at2, at2 + p2.length) },
      },
    };
    const file = join(workspace, "siblings.md");
    writeDoc(file, seeded, body);

    const { frontmatter, body: onDisk } = readDoc(file);
    const newBody = onDisk.replace(`\n\n${p2}`, "").replace("apples", "oranges");
    const { anchors, report } = reconcileAnchors(onDisk, newBody, frontmatter.anchors);
    writeDoc(file, { ...frontmatter, anchors }, newBody);

    expect(report).toEqual({ unchanged: [], remapped: [], orphaned: ["anc_one1", "anc_two2"] });
    // Byte-for-byte: same frontmatter as seeded, only the body edited.
    expect(readFileSync(file, "utf8")).toBe(`---\n${stringify(seeded)}---\n${newBody}`);
    const persisted = readDoc(file).frontmatter.anchors;
    expect(persisted["anc_one1"]).toEqual(seeded.anchors["anc_one1"]);
    expect(persisted["anc_two2"]).toEqual(seeded.anchors["anc_two2"]);
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
