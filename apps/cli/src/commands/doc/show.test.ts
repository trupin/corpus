import { afterEach, describe, expect, it } from "vitest";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { docTopic } from "./index.js";
import { runDocShow, showCommand } from "./show.js";

/**
 * The rendering is the contract here: `corpus doc show` is what the product
 * agent reads a document with, so every assertion below compares whole stdout
 * rather than probing for substrings — a field that quietly stopped printing
 * would otherwise pass.
 */

const NOTE = {
  frontmatter: {
    id: "doc_a1b2c3",
    type: "note",
    title: "Mortgage options",
    created: "2026-07-28T10:00:00.000Z",
    updated: "2026-07-28T11:30:00.000Z",
    tags: ["finance", "housing"],
    status: "open",
    anchors: {},
    due: null,
    reviewed: null,
    evergreen: false,
    pinned: false,
    order: null,
    query: null,
    column: null,
    extra: {},
  },
  body: "30-year fixed at 6.1%.\n",
  path: "data/docs/finance/mortgage-options.md",
  anchors: [
    {
      anchorId: "anc_1",
      selector: { exact: "30-year fixed at 6.1%" },
      threadId: "th_x9y8",
      threadStatus: "open",
      range: { start: 12, end: 45 },
      orphaned: false,
    },
    {
      anchorId: "anc_2",
      selector: { exact: "the model  we\nassumed", prefix: "before " },
      threadId: "th_q1w2",
      threadStatus: "resolved",
      range: null,
      orphaned: true,
    },
  ],
};

/** A hand-written `SKILL.md`: no frontmatter timestamps, no tags, no anchors. */
const SKILL = {
  frontmatter: {
    ...NOTE.frontmatter,
    id: "doc_skill1a2b3c4d",
    type: "skill",
    title: "orchestrate",
    created: null,
    updated: null,
    tags: [],
  },
  body: "Run the loop.\n",
  path: ".claude/skills/orchestrate/SKILL.md",
  anchors: [],
};

const ARGS = { id: "doc_a1b2c3" };

afterEach(closeStubServers);

describe("corpus doc show", () => {
  it("reads the document by id and renders header, anchors and body", async () => {
    const stub = await startStubServer(jsonResponder(200, NOTE));

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/docs/doc_a1b2c3");
    expect(harness.stdout()).toBe(
      [
        "Mortgage options",
        "doc_a1b2c3 · note · open",
        "data/docs/finance/mortgage-options.md",
        "created 2026-07-28T10:00:00.000Z · updated 2026-07-28T11:30:00.000Z",
        "tags finance, housing",
        "anchors:",
        '  anc_1 → th_x9y8 (open) · chars 12–45 · "30-year fixed at 6.1%"',
        '  anc_2 → th_q1w2 (resolved) · orphaned, its quote is no longer in the body · "the model we assumed"',
        "",
        "30-year fixed at 6.1%.",
        "",
      ].join("\n"),
    );
  });

  it("renders absent timestamps as — rather than substituting a date", async () => {
    const stub = await startStubServer(jsonResponder(200, SKILL));

    const harness = stubContext(stub, { args: { id: "doc_skill1a2b3c4d" } });
    await runDocShow(harness.context);

    expect(harness.stdout()).toBe(
      [
        "orchestrate",
        "doc_skill1a2b3c4d · skill · open",
        ".claude/skills/orchestrate/SKILL.md",
        "created — · updated —",
        "tags —",
        "",
        "Run the loop.",
        "",
      ].join("\n"),
    );
    expect(harness.stdout()).not.toMatch(/1970/);
  });

  it("keeps nulls null under --json, and emits exactly one value", async () => {
    const stub = await startStubServer(jsonResponder(200, SKILL));

    const harness = stubContext(stub, { args: { id: "doc_skill1a2b3c4d" }, json: true });
    await runDocShow(harness.context);

    const emitted = harness.stdout();
    expect(emitted.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(emitted)).toEqual(SKILL);
    expect((JSON.parse(emitted) as typeof SKILL).frontmatter.created).toBeNull();
  });

  it("emits the server's payload unreshaped", async () => {
    const stub = await startStubServer(jsonResponder(200, NOTE));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runDocShow(harness.context);

    // Deep equality both ways: no field dropped, no field invented.
    expect(JSON.parse(harness.stdout())).toEqual(NOTE);
    expect(harness.stdout()).toBe(`${JSON.stringify(NOTE)}\n`);
  });

  it("prints the deadline line only when the document carries one of its fields", async () => {
    const dated = {
      ...NOTE,
      frontmatter: { ...NOTE.frontmatter, due: "2026-08-01", evergreen: true },
      anchors: [],
    };
    const stub = await startStubServer(jsonResponder(200, dated));

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    expect(harness.stdout()).toContain("due 2026-08-01 · reviewed — · evergreen yes\n");
  });

  it("says so plainly when the body is empty", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...NOTE, body: "   \n", anchors: [] }));

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    expect(harness.stdout().endsWith("\n(no body)\n")).toBe(true);
  });

  it("collapses a long anchor quote onto its one line", async () => {
    const long = "a".repeat(120);
    const stub = await startStubServer(
      jsonResponder(200, {
        ...NOTE,
        anchors: [{ ...NOTE.anchors[0], selector: { exact: long } }],
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    expect(harness.stdout()).toContain(`"${"a".repeat(59)}…"`);
  });
});

describe("the doc show command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [docTopic] })).toEqual(
      [],
    );
  });

  it("is a workspace command taking one required id and no flags of its own", () => {
    expect(showCommand.requiresWorkspace).not.toBe(false);
    expect(showCommand.args).toEqual([
      { name: "id", required: true, description: "The document's id." },
    ]);
    // `--from` is global; a verb declaring it fails registry validation.
    expect(showCommand.flags).toEqual([]);
  });

  it("carries a plain example and a --json example that inlines its shape", () => {
    expect(showCommand.examples).toHaveLength(2);
    const machine = showCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('{"frontmatter"');
    expect(machine?.description).toContain('"anchors"');
  });

  it("is reachable as `corpus doc show`", () => {
    expect(docTopic.commands.map((command) => command.name)).toContain("show");
  });
});
