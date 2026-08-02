import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SEMANTIC_INDEX_STATES,
  type AnchoredContextPack,
  type ContextExcerpt,
  type ContextPack,
  type DeletedParentContextPack,
  type OrphanedAnchorContextPack,
  type StandaloneContextPack,
  type WholeDocumentContextPack,
} from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { contextCommand, runThreadContext } from "./context.js";
import { threadTopic } from "./index.js";

/**
 * The briefing, shape by shape. Every rendering test asserts the **exact**
 * output: this is what an agent reads before it answers a comment, so a stray
 * blank line or a reordered block is a behaviour change, not a formatting one.
 *
 * The five shapes are the contract's (`CONTEXT_PACK_SHAPES`), and the packs
 * below are shaped after the payloads SERVER-047 recorded off a real workspace.
 */

const excerpt = (overrides: Partial<ContextExcerpt> = {}): ContextExcerpt => ({
  id: "doc_kp62gce5",
  headingPath: "Impound account true-up",
  excerpt: "The lender re-runs the impound analysis every twelve months.",
  relation: "similar",
  ...overrides,
});

/** The envelope fields every shape carries, so each fixture declares only its own. */
const base: Pick<ContextPack, "threadId" | "excerpts"> = {
  threadId: "th_zdg2aius",
  excerpts: [excerpt()],
};

const anchored = (
  parent: Partial<AnchoredContextPack["parent"]> = {},
  rest: Partial<AnchoredContextPack> = {},
): AnchoredContextPack => ({
  shape: "anchored",
  ...base,
  parent: {
    id: "doc_54oblxxe",
    title: "Mortgage options",
    headingPath: "Mortgage › Escrow",
    quote: "recalculated annually under fixed terms",
    section:
      "## Escrow\n\nThe escrow reserve is recalculated annually under fixed terms.\n\nA second paragraph.\n\n",
    truncated: false,
    ...parent,
  },
  ...rest,
});

const wholeDocument = (
  parent: Partial<WholeDocumentContextPack["parent"]> = {},
): WholeDocumentContextPack => ({
  shape: "whole-document",
  ...base,
  parent: {
    id: "doc_54oblxxe",
    title: "Mortgage note",
    opening: "Preamble sentence that opens the mortgage note.\n\n",
    truncated: false,
    ...parent,
  },
});

const orphaned = (
  parent: Partial<OrphanedAnchorContextPack["parent"]> = {},
): OrphanedAnchorContextPack => ({
  shape: "orphaned-anchor",
  ...base,
  parent: {
    id: "doc_u3dbw462",
    title: "Long doc",
    quote: "THE ANCHOR PHRASE LIVES HERE.",
    truncated: false,
    ...parent,
  },
});

const standalone = (rest: Partial<StandaloneContextPack> = {}): StandaloneContextPack => ({
  shape: "standalone",
  ...base,
  ...rest,
});

const parentDeleted = (): DeletedParentContextPack => ({
  shape: "parent-deleted",
  ...base,
  deletedParent: "doc_xbnup3ze",
});

/** Runs the verb against a stub answering `pack`, and returns everything it wrote. */
async function render(pack: ContextPack, json = false): Promise<string> {
  const stub = await startStubServer(jsonResponder(200, pack));
  const harness = stubContext(stub, { args: { id: pack.threadId }, json });

  await runThreadContext(harness.context);

  return harness.stdout();
}

const withSemanticIndex = (pack: ContextPack, state: string): ContextPack =>
  ({ ...pack, semanticIndex: state }) as ContextPack;

afterEach(closeStubServers);

describe("corpus thread context", () => {
  it("reads the context route for the given id, sending no query at all", async () => {
    const stub = await startStubServer(jsonResponder(200, anchored()));
    const harness = stubContext(stub, { args: { id: "th_zdg2aius" } });

    await runThreadContext(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/threads/th_zdg2aius/context");
    expect(stub.requests[0]?.url).toBe("/api/threads/th_zdg2aius/context");
  });

  it("briefs an anchored thread: the parent, the quote, its whole section, then the excerpts", async () => {
    expect(await render(anchored())).toBe(
      [
        "parent doc_54oblxxe · Mortgage options · Mortgage › Escrow",
        "",
        "> recalculated annually under fixed terms",
        "",
        "## Escrow",
        "",
        "The escrow reserve is recalculated annually under fixed terms.",
        "",
        "A second paragraph.",
        "",
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
  });

  it("briefs a whole-document thread with the parent's title and opening, and no heading path", async () => {
    expect(await render(wholeDocument())).toBe(
      [
        "parent doc_54oblxxe · Mortgage note",
        "",
        "Preamble sentence that opens the mortgage note.",
        "",
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
  });

  it("says an orphaned anchor is orphaned, and prints the preserved quote", async () => {
    const output = await render(orphaned());

    expect(output).toBe(
      [
        "parent doc_u3dbw462 · Long doc",
        "the anchor no longer resolves in the parent (SPEC.md §6); the quote the thread was opened on is preserved below, and where that text went is not guessed at:",
        "",
        "> THE ANCHOR PHRASE LIVES HERE.",
        "",
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
    // No passage is invented for a quote that no longer resolves.
    expect(output).not.toContain("## ");
  });

  // The server returns `quote: ""` when neither the frontmatter selector nor the
  // projection row survived: a real state, and the one the "preserved below:"
  // sentence must not be printed for — a colon pointing at nothing promises the
  // agent text that never arrives.
  it("says the quote could not be recovered when the orphan kept none, and prints no empty block", async () => {
    const output = await render(orphaned({ quote: "" }));

    expect(output).toBe(
      [
        "parent doc_u3dbw462 · Long doc",
        "the anchor no longer resolves in the parent (SPEC.md §6), and the quote the thread was opened on was not preserved either, so the original text cannot be recovered and is not guessed at.",
        "",
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
    // Neither half of the promise: no colon pointing forward, no quote block.
    expect(output).not.toContain("preserved below");
    expect(output).not.toContain(">");
  });

  it("keeps the sentence and the block agreeing when the quote is only whitespace", async () => {
    // `quoteLines` prints nothing for a blank quote, so the sentence must be the
    // one that claims nothing — the two are decided by the same test.
    const output = await render(orphaned({ quote: "  \n  " }));

    expect(output).toContain("cannot be recovered");
    expect(output).not.toContain(">");
  });

  it("prints no parent block for a standalone thread, and no empty heading for one", async () => {
    const output = await render(standalone());

    expect(output).toBe(
      [
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
    expect(output).not.toContain("parent");
    // Not one blank line where the parent block would have been: the absence is
    // the whole rendering, not a hole in it.
    expect(
      output
        .trimEnd()
        .split("\n")
        .filter((line) => line === ""),
    ).toEqual([]);
  });

  it("states a deleted parent by id, and still briefs the conversation", async () => {
    expect(await render(parentDeleted())).toBe(
      [
        "parent doc_xbnup3ze was deleted; this conversation outlived it, so there is no parent content to show (SPEC.md §9.2).",
        "",
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
  });

  it("reads top-down: the passage, then the excerpts, then the degrade note last", async () => {
    const lines = (await render(withSemanticIndex(anchored(), "stale"))).split("\n");

    expect(lines[0]).toContain("parent doc_54oblxxe");
    expect(lines.indexOf("# related excerpts")).toBeGreaterThan(0);
    expect(lines.findIndex((line) => line.startsWith("doc_kp62gce5"))).toBeGreaterThan(
      lines.indexOf("# related excerpts"),
    );
    // The note is the last thing written, after everything it qualifies.
    expect(lines.at(-2)).toContain("# ranking is degraded");
    expect(lines.at(-1)).toBe("");
  });

  it("prints one padded four-column row per excerpt, with the free text last", async () => {
    const pack = standalone({
      excerpts: [
        excerpt(),
        excerpt({
          id: "doc_zz",
          headingPath: "Boilers › Quotes",
          relation: "linked",
          excerpt: "The boiler swap is scheduled for the spring.",
        }),
      ],
    });

    expect(await render(pack)).toBe(
      [
        "# related excerpts",
        "doc_kp62gce5  Impound account true-up  similar  The lender re-runs the impound analysis every twelve months.",
        "doc_zz        Boilers › Quotes         linked   The boiler swap is scheduled for the spring.",
        "",
      ].join("\n"),
    );
  });

  it("keeps an excerpt on one line even when the passage arrives with newlines", async () => {
    const pack = standalone({
      excerpts: [excerpt({ headingPath: "Head\nSub", excerpt: "first\nsecond  third" })],
    });

    expect(await render(pack)).toBe(
      ["# related excerpts", "doc_kp62gce5  Head Sub  similar  first second third", ""].join("\n"),
    );
  });

  it("falls back to the absent-value glyph when a row has no address at all", async () => {
    const pack = standalone({ excerpts: [excerpt({ headingPath: "" })] });

    expect(await render(pack)).toBe(
      [
        "# related excerpts",
        "doc_kp62gce5  —  similar  The lender re-runs the impound analysis every twelve months.",
        "",
      ].join("\n"),
    );
  });

  it("reports a thread nothing relates to honestly, and exits 0", async () => {
    expect(await render(standalone({ excerpts: [] }))).toBe("no related excerpts.\n");
  });

  it("keeps the parent block when there is nothing related", async () => {
    expect(await render({ ...anchored(), excerpts: [] })).toBe(
      [
        "parent doc_54oblxxe · Mortgage options · Mortgage › Escrow",
        "",
        "> recalculated annually under fixed terms",
        "",
        "## Escrow",
        "",
        "The escrow reserve is recalculated annually under fixed terms.",
        "",
        "A second paragraph.",
        "",
        "no related excerpts.",
        "",
      ].join("\n"),
    );
  });

  it("states a truncated section and names the escalation", async () => {
    const output = await render(anchored({ truncated: true }));

    expect(output).toContain(
      "# the parent text above was cut to fit the pack's bounds — read all of it with: corpus doc show doc_54oblxxe",
    );
    // Immediately after the prose it qualifies, before the excerpts.
    const lines = output.split("\n");
    expect(lines.findIndex((line) => line.startsWith("# the parent text"))).toBeLessThan(
      lines.indexOf("# related excerpts"),
    );
  });

  it("says nothing about truncation when nothing was cut", async () => {
    for (const pack of [anchored(), wholeDocument(), orphaned()]) {
      expect(await render(pack)).not.toContain("was cut to fit");
    }
  });

  it("states a truncated quote on an orphaned anchor too, naming its parent", async () => {
    expect(await render(orphaned({ truncated: true }))).toContain(
      "read all of it with: corpus doc show doc_u3dbw462",
    );
  });

  it("renders a multi-line quote as a quote, one prefix per line", async () => {
    expect(await render(anchored({ quote: "first line\n\nthird line" }))).toContain(
      ["> first line", ">", "> third line"].join("\n"),
    );
  });

  it("emits the server's envelope unchanged under --json, and no human line", async () => {
    const pack = withSemanticIndex(anchored(), "current");

    expect(await render(pack, true)).toBe(`${JSON.stringify(pack)}\n`);
  });

  it("says nothing about ranking when the server makes no claim", async () => {
    expect(await render(anchored())).not.toContain("#Analysis");
    expect(await render(anchored())).not.toContain("ranking is degraded");
    expect(await render(withSemanticIndex(standalone(), "current"))).not.toContain(
      "ranking is degraded",
    );
  });

  // The same generic note the other two retrieval verbs print, for the same wire
  // values — never a per-state wording (sprint-021 C15).
  it.each(SEMANTIC_INDEX_STATES.filter((state) => state !== "current"))(
    "warns on the wire value %s, and names it",
    async (state) => {
      const lines = (await render(withSemanticIndex(standalone(), state))).split("\n");
      const note = lines.at(-2) ?? "";

      expect(note).toContain("# ranking is degraded");
      expect(note).toContain(state);
    },
  );

  it("treats an unknown thread as the shipped 404 — exit 5, message verbatim", async () => {
    const stub = await startStubServer(
      jsonResponder(404, { code: "not_found", message: "no thread with id th_nope" }),
    );
    const harness = stubContext(stub, { args: { id: "th_nope" } });

    const error: unknown = await runThreadContext(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("404 not_found: no thread with id th_nope");
  });
});

describe("the thread context command spec", () => {
  it("keeps the topic a valid registry topic and is reachable as `corpus thread context`", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
    expect(threadTopic.commands.map((command) => command.name)).toContain("context");
  });

  it("takes the thread id and declares no flags at all", () => {
    expect(contextCommand.args.map((arg) => ({ name: arg.name, required: arg.required }))).toEqual([
      { name: "id", required: true },
    ]);
    expect(contextCommand.args[0]?.description).not.toBe("");
    // A local `--json` would shadow the global one and be rejected at load; the
    // bounds live in the contract, so there is nothing else to declare.
    expect(contextCommand.flags).toEqual([]);
  });

  it("documents the bounds, the escalation and the 404", () => {
    expect(contextCommand.description).toContain("bounded by contract");
    expect(contextCommand.description).toContain("corpus doc show");
    expect(contextCommand.description).toContain("never a body");
    expect(contextCommand.description).toContain("exit 5");
  });

  it("carries a --json example that inlines the pack's shape", () => {
    const machine = contextCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"shape"');
    expect(machine?.description).toContain('"excerpts"');
  });

  it("reads through the ordinary client, never the untimed seam", async () => {
    // `untimedApi` exists for `db rebuild`'s ten-minute run; a pack is a
    // projection read and must not opt out of the standard timeout.
    const source = await readFile(join(import.meta.dirname, "context.ts"), "utf8");
    expect(source).not.toContain("untimedApi");
    expect(source).toContain("context.client.request");
  });
});
