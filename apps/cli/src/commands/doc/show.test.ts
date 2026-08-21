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
    origin: null,
    pinned: false,
    order: null,
    query: null,
    column: null,
    extra: {},
  },
  body: "30-year fixed at 6.1%.\n",
  path: "data/docs/finance/mortgage-options.md",
  key: "3b2ec1f04d75a2c6ef2b8b9a1f0c4d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3",
  userEditing: false,
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
  key: "9c8b7a6d5e4f30291a0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f607",
  userEditing: false,
  anchors: [],
};

const ARGS = { id: "doc_a1b2c3" };

const hasNotice = (line: string): boolean => line.includes("someone is editing this");

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
        `key ${NOTE.key}`,
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
        `key ${SKILL.key}`,
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

  it("prints the key whole, on the third line, where a writer will carry it", async () => {
    const stub = await startStubServer(jsonResponder(200, NOTE));

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    // Third line, not buried under the body: the key is the one thing this read
    // hands over that the next command cannot do without.
    expect(harness.stdout().split("\n")[2]).toBe(`key ${NOTE.key}`);
    // Whole, never abbreviated — the agent copies what it reads, and half a key
    // is not a key (the contract's opacity rules).
    expect(NOTE.key).toHaveLength(64);
    expect(harness.stdout()).toContain(NOTE.key);
  });

  it("says a person is editing, as an invitation rather than a refusal", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...NOTE, userEditing: true }));

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    const [notice] = harness.stdout().split("\n").filter(hasNotice);
    expect(notice).toContain("someone is editing this");
    // §7's trade, stated where it is acted on: nothing is refused for it, and
    // the way to be polite is named rather than implied.
    expect(notice).toContain("Nothing is refused for it");
    expect(notice).toContain("corpus queue defer <event-id> --blocked-on doc_a1b2c3");
    // Nothing to release, and nothing read-only: the lock's vocabulary must not
    // come back in through the wording.
    // `--blocked-on` is the flag's real name, so the word boundary matters:
    // what must not appear is a *lock*, a *release*, or a read-only document.
    expect(notice).not.toMatch(/\block(ed|s|ing)?\b|\brelease|read-only/i);
  });

  it("says nothing about editing when nobody is", async () => {
    const stub = await startStubServer(jsonResponder(200, NOTE));

    const harness = stubContext(stub, { args: ARGS });
    await runDocShow(harness.context);

    expect(harness.stdout()).not.toContain("someone is editing");
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

/**
 * The narrow reads (CLI-055). The property under test throughout is that what
 * reaches stdout is a **substring of the body the server sent** — not a
 * rendering of it — because that string is what `POST /api/docs/{id}/patch`
 * matches `--old` against. `corpus search`'s snippet failed exactly here: it
 * was ellipsized and newline-collapsed, and a snippet spanning a line break
 * matched 0 times.
 */
describe("corpus doc show --headings / --section", () => {
  const SECTIONED = {
    ...NOTE,
    anchors: [],
    body: [
      "# Mortgage options",
      "",
      "Opening paragraph.",
      "",
      "## Rates",
      "",
      "The rate lock runs 30 days.",
      "",
      "## Escrow",
      "",
      "The escrow reserve is recalculated annually.",
      "It draws on the impound account,",
      "and the true-up arrives in February.",
      "",
    ].join("\n"),
  };

  const ESCROW = "Mortgage options › Escrow";

  const showing = async (
    flags: Record<string, string | number | boolean>,
    options: { readonly json?: boolean; readonly doc?: typeof SECTIONED } = {},
  ) => {
    const stub = await startStubServer(jsonResponder(200, options.doc ?? SECTIONED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags,
      ...(options.json === undefined ? {} : { json: options.json }),
    });
    return { stub, harness };
  };

  it("prints one heading path per line and nothing else", async () => {
    const { harness } = await showing({ headings: true });
    await runDocShow(harness.context);

    expect(harness.stdout()).toBe(
      ["Mortgage options", "Mortgage options › Rates", ESCROW, ""].join("\n"),
    );
  });

  it("prints a section byte for byte, with no newline of its own added", async () => {
    const { harness } = await showing({ section: ESCROW });
    await runDocShow(harness.context);

    expect(harness.stdout()).toBe(
      [
        "## Escrow",
        "",
        "The escrow reserve is recalculated annually.",
        "It draws on the impound account,",
        "and the true-up arrives in February.",
        "",
      ].join("\n"),
    );
    // The one assertion the whole feature rests on.
    expect(SECTIONED.body).toContain(harness.stdout());
    expect(harness.stdout()).not.toContain("…");
  });

  it("still makes exactly the one request the whole read would have made", async () => {
    const { stub, harness } = await showing({ section: ESCROW });
    await runDocShow(harness.context);

    // The saving is the reader's context, not the wire — the body crosses it
    // whole either way, and the help text says so rather than implying a
    // smaller request (CLI-055 decision 1).
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.path).toBe("/api/docs/doc_a1b2c3");
  });

  it("carries the same characters under --json, unprettified and as one value", async () => {
    const { harness } = await showing({ section: ESCROW }, { json: true });
    await runDocShow(harness.context);

    const emitted = harness.stdout();
    expect(emitted.trimEnd().split("\n")).toHaveLength(1);
    const value = JSON.parse(emitted) as { id: string; headingPath: string; section: string };
    expect(Object.keys(value)).toEqual(["id", "headingPath", "section"]);
    expect(value.id).toBe("doc_a1b2c3");
    expect(value.headingPath).toBe(ESCROW);
    // The newline the snippet would have collapsed, still there.
    expect(value.section).toContain("impound account,\nand the true-up");
    expect(SECTIONED.body).toContain(value.section);
  });

  it("describes each heading structurally under --json", async () => {
    const { harness } = await showing({ headings: true }, { json: true });
    await runDocShow(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({
      id: "doc_a1b2c3",
      headings: [
        { headingPath: "Mortgage options", level: 1, chars: 40 },
        { headingPath: "Mortgage options › Rates", level: 2, chars: 39 },
        { headingPath: ESCROW, level: 2, chars: 126 },
      ],
    });
  });

  it("refuses a path naming nothing, printing no part of the body", async () => {
    const { harness } = await showing({ section: "Escrow" });

    await expect(runDocShow(harness.context)).rejects.toThrow(
      '--section "Escrow" names no section of doc_a1b2c3',
    );
    expect(harness.stdout()).toBe("");
  });

  it("says so plainly when the document has no sections at all", async () => {
    const { harness } = await showing({ headings: true }, { doc: { ...SECTIONED, body: "\n" } });
    await runDocShow(harness.context);

    expect(harness.stdout()).toBe("no sections — the body of doc_a1b2c3 is empty.\n");
  });

  it("makes a headingless document one section, and reads it back whole", async () => {
    const plain = { ...SECTIONED, body: "30-year fixed at 6.1%.\n" };
    const { harness } = await showing({ section: "Mortgage options" }, { doc: plain });
    await runDocShow(harness.context);

    // Not a fallback: `--headings` lists this one address, and the caller named
    // it. A document with no headings genuinely is one section.
    expect(harness.stdout()).toBe(plain.body);
  });

  it("refuses --headings and --section together, before the request", async () => {
    const { stub, harness } = await showing({ headings: true, section: ESCROW });

    await expect(runDocShow(harness.context)).rejects.toThrow(
      "--headings and --section ask for different things.",
    );
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses --nth without a --section to count in, before the request", async () => {
    const { stub, harness } = await showing({ nth: 2 });

    await expect(runDocShow(harness.context)).rejects.toThrow("--nth chooses between sections");
    expect(stub.requests).toHaveLength(0);
  });

  it.each([0, -1, 1.5])("refuses --nth %s, which is not a position", async (nth) => {
    const { stub, harness } = await showing({ section: ESCROW, nth });

    await expect(runDocShow(harness.context)).rejects.toThrow("--nth counts sections from 1");
    expect(stub.requests).toHaveLength(0);
  });

  it("chooses between repeated headings with --nth", async () => {
    const repeated = { ...SECTIONED, body: "## Notes\n\nfirst\n\n## Notes\n\nsecond\n" };
    const { harness } = await showing({ section: "Notes", nth: 2 }, { doc: repeated });
    await runDocShow(harness.context);

    expect(harness.stdout()).toBe("## Notes\n\nsecond\n");
  });

  it("refuses a repeated heading rather than silently printing the first", async () => {
    const repeated = { ...SECTIONED, body: "## Notes\n\nfirst\n\n## Notes\n\nsecond\n" };
    const { harness } = await showing({ section: "Notes" }, { doc: repeated });

    await expect(runDocShow(harness.context)).rejects.toThrow(
      '--section "Notes" names 2 sections of doc_a1b2c3',
    );
    expect(harness.stdout()).toBe("");
  });

  it("reads the whole document when neither flag is passed", async () => {
    const { harness } = await showing({});
    await runDocShow(harness.context);

    expect(harness.stdout()).toContain(`key ${NOTE.key}`);
    expect(harness.stdout()).toContain("The escrow reserve is recalculated annually.");
  });
});

describe("corpus doc show anchor rendering", () => {
  it("collapses a long anchor quote onto its one line (regression)", async () => {
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

  it("is a workspace command taking one required id and the three narrowing flags", () => {
    expect(showCommand.requiresWorkspace).not.toBe(false);
    expect(showCommand.args).toEqual([
      { name: "id", required: true, description: "The document's id." },
    ]);
    // `--from` is global; a verb declaring it fails registry validation.
    expect(showCommand.flags.map((flag) => flag.name)).toEqual(["headings", "section", "nth"]);
    expect(showCommand.flags.map((flag) => flag.type)).toEqual(["boolean", "string", "number"]);
  });

  it("carries a plain example, the key-extraction one, and a --json example that inlines its shape", () => {
    const machine = showCommand.examples.find((example) =>
      example.description.includes('{"frontmatter"'),
    );
    expect(machine?.description).toContain('"anchors"');
    expect(machine?.description).toContain('"key"');
  });

  it("shows the read-a-section-then-patch loop, which is the reason the flags exist", () => {
    const roundTrip = showCommand.examples.find((example) => example.command.includes("doc patch"));
    expect(roundTrip?.command).toContain("--section 'Mortgage options › Escrow'");
    expect(roundTrip?.command).toContain("--old-file /tmp/old.md");
  });

  it("says the saving is the reader's context and not the wire", () => {
    // The request is unchanged, so claiming a smaller wire would be a lie the
    // help text told on the CLI's behalf (CLI-055 decision 1).
    expect(showCommand.description).toContain("not what crosses the wire");
    expect(showCommand.description).toContain("byte for byte");
    expect(showCommand.description).toContain("never falls back to printing the whole body");
  });

  it("documents the key and the editing signal, because the help is where a writer learns them", () => {
    expect(showCommand.description).toContain("`key`");
    expect(showCommand.description).toContain("corpus doc edit <id> --key <key>");
    expect(showCommand.description).toContain("edit session");
    // The signal must not be published as a gate: that misreading is exactly
    // the lock's failure re-learned one layer up.
    expect(showCommand.description).toContain("information, not a refusal");
  });

  it("is reachable as `corpus doc show`", () => {
    expect(docTopic.commands.map((command) => command.name)).toContain("show");
  });
});
