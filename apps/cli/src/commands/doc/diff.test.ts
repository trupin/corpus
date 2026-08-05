import { DOC_DIFF_MAX_CHARS, EMPTY_TREE_OBJECT_ID, type DocDiff } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { GLOBAL_FLAG_NAMES } from "../../registry/globals.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { diffCommand, runDocDiff } from "./diff.js";
import { docTopic } from "./index.js";

/**
 * The verb a `doc.edited` event is escalated into. Two properties carry the
 * weight: the event's range reaches the wire untransformed, and a truncated diff
 * cannot be mistaken for a whole one.
 */

/** A range shaped exactly like the one a `doc.edited` event carries. */
const FROM = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const TO = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456";

const HUNK = "@@ -1,3 +1,4 @@\n-30-year fixed at 6.1%.\n+30-year fixed at 6.4%.\n+Rate locked.\n";

const diff = (overrides: Partial<DocDiff> = {}): DocDiff => ({
  id: "doc_a1b2c3",
  path: "data/docs/finance/mortgage-options.md",
  from: FROM,
  to: TO,
  stats: { commits: 1, insertions: 2, deletions: 1 },
  diff: HUNK,
  truncated: false,
  totalChars: HUNK.length,
  ...overrides,
});

const query = (request: { readonly query: URLSearchParams } | undefined): Record<string, string> =>
  Object.fromEntries(request?.query ?? new URLSearchParams());

afterEach(closeStubServers);

describe("corpus doc diff", () => {
  it("reads the diff route for the given id, sending no range it was not given", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/docs/doc_a1b2c3/diff");
    // The bare call is legal: both halves default server-side (CONTRACT-028 §6).
    expect(query(stub.requests[0])).toEqual({});
  });

  it("passes a doc.edited event's range straight through, unchanged", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));

    // Exactly the two payload fields, no transformation between event and flag.
    const event = { from: FROM, to: TO };
    await runDocDiff(
      stubContext(stub, {
        args: { id: "doc_a1b2c3" },
        flags: { "from-rev": event.from, "to-rev": event.to },
      }).context,
    );

    expect(query(stub.requests[0])).toEqual({ from: FROM, to: TO });
  });

  it("passes the empty-tree sha of a first-commit event through like any other", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        diff({ from: EMPTY_TREE_OBJECT_ID, stats: { commits: 1, insertions: 4, deletions: 0 } }),
      ),
    );
    const harness = stubContext(stub, {
      args: { id: "doc_a1b2c3" },
      flags: { "from-rev": EMPTY_TREE_OBJECT_ID, "to-rev": TO },
    });

    await runDocDiff(harness.context);

    expect(query(stub.requests[0])).toEqual({ from: EMPTY_TREE_OBJECT_ID, to: TO });
    expect(harness.stdout()).toContain(`${EMPTY_TREE_OBJECT_ID}..${TO}`);
  });

  it("sends one half alone when only one was given", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    await runDocDiff(
      stubContext(stub, { args: { id: "doc_a1b2c3" }, flags: { "to-rev": TO } }).context,
    );

    expect(query(stub.requests[0])).toEqual({ to: TO });
  });

  it("prints identity, the resolved range, the counts, then the diff itself", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout()).toBe(
      [
        "doc_a1b2c3 · data/docs/finance/mortgage-options.md",
        `${FROM}..${TO}`,
        `1 commit · +2 -1 · ${String(HUNK.length)} characters`,
        "",
        "@@ -1,3 +1,4 @@",
        "-30-year fixed at 6.1%.",
        "+30-year fixed at 6.4%.",
        "+Rate locked.",
        "",
      ].join("\n"),
    );
  });

  it("prints the shas unabbreviated, so the same range can be pinned again", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    const range = harness.stdout().split("\n")[1];
    expect(range).toBe(`${FROM}..${TO}`);
    expect(range).not.toContain("…");
  });

  it("says how many commits the range held, in English", async () => {
    const stub = await startStubServer(
      jsonResponder(200, diff({ stats: { commits: 3, insertions: 40, deletions: 12 } })),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout().split("\n")[2]).toBe(
      `3 commits · +40 -12 · ${String(HUNK.length)} characters`,
    );
  });

  it("passes the diff through byte for byte, keeping a blank context line", async () => {
    // A blank line in the document is a single space in a unified diff; trimming
    // the body would drop it and change what the agent reads.
    const body = "@@ -1,2 +1,2 @@\n-old\n \n+new\n";
    const stub = await startStubServer(
      jsonResponder(200, diff({ diff: body, totalChars: body.length })),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout()).toContain("@@ -1,2 +1,2 @@\n-old\n \n+new\n");
  });

  it("renders nothing in the diff — a markdown diff is text, not a document", async () => {
    const body = "@@ -1 +1 @@\n-# Heading\n+## Heading\n";
    const stub = await startStubServer(
      jsonResponder(200, diff({ diff: body, totalChars: body.length })),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout()).toContain("-# Heading\n+## Heading");
  });
});

describe("corpus doc diff — the answers that are not failures", () => {
  it("reports a range in which nothing changed as nothing, and exits 0", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        diff({ diff: "", totalChars: 0, stats: { commits: 0, insertions: 0, deletions: 0 } }),
      ),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await expect(runDocDiff(harness.context)).resolves.toBeUndefined();

    expect(harness.stdout()).toBe(
      [
        "doc_a1b2c3 · data/docs/finance/mortgage-options.md",
        `${FROM}..${TO}`,
        "0 commits · +0 -0 · 0 characters",
        "",
        "no change in this range.",
        "",
      ].join("\n"),
    );
    expect(harness.stderr()).toBe("");
  });

  it("reports a document with no committed history as an answer, not an error", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        diff({
          from: null,
          to: null,
          diff: "",
          totalChars: 0,
          stats: { commits: 0, insertions: 0, deletions: 0 },
        }),
      ),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await expect(runDocDiff(harness.context)).resolves.toBeUndefined();

    expect(harness.stdout()).toBe(
      [
        "doc_a1b2c3 · data/docs/finance/mortgage-options.md",
        "no committed history for this document — nothing to diff.",
        "",
      ].join("\n"),
    );
  });

  it("never prints a half-null range", async () => {
    // The contract nulls both halves together; if that ever changed, printing
    // `null..9f1c2ab` would be worse than saying there is no range.
    const stub = await startStubServer(jsonResponder(200, diff({ from: null })));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout()).not.toContain("null");
    expect(harness.stdout()).toContain("no committed history");
  });
});

describe("corpus doc diff — truncation", () => {
  const cut = (): DocDiff =>
    diff({
      diff: HUNK,
      truncated: true,
      totalChars: 61200,
      stats: { commits: 1, insertions: 900, deletions: 900 },
    });

  it("states the scale before the body, in the slot the whole case uses too", async () => {
    const stub = await startStubServer(jsonResponder(200, cut()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout().split("\n")[2]).toBe(
      `1 commit · +900 -900 · showing ${String(HUNK.length)} of 61200 characters`,
    );
  });

  it("states the cut again where the text stops, with what is missing and what to do", async () => {
    const stub = await startStubServer(jsonResponder(200, cut()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    const notice = harness.stdout().trimEnd().split("\n").at(-1) ?? "";
    expect(notice.startsWith("# ")).toBe(true);
    expect(notice).toContain("cut at a hunk boundary");
    expect(notice).toContain(`${String(DOC_DIFF_MAX_CHARS)}-character`);
    expect(notice).toContain(`stops ${String(61200 - HUNK.length)} characters short`);
    expect(notice).toContain("Do not read it as the whole change");
    expect(notice).toContain("--from-rev/--to-rev");
    expect(notice).toContain("corpus doc show doc_a1b2c3");
  });

  it("keeps the notice on one line, so a caller reading the last line gets all of it", async () => {
    const stub = await startStubServer(jsonResponder(200, cut()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    const lines = harness.stdout().trimEnd().split("\n");
    expect(lines.filter((line) => line.startsWith("#"))).toHaveLength(1);
  });

  it("says nothing about a cut when there was none", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocDiff(harness.context);

    expect(harness.stdout()).not.toContain("#");
    expect(harness.stdout()).not.toContain("showing");
  });
});

describe("corpus doc diff — revisions and errors", () => {
  it("emits the server's envelope unchanged under --json, and no human line", async () => {
    const body = diff({ truncated: true, totalChars: 61200 });
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" }, json: true });

    await runDocDiff(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(body)}\n`);
  });

  it.each([
    ["HEAD~1", "from-rev"],
    ["--output=/tmp/x", "from-rev"],
    ["main", "to-rev"],
    ["9F1C2AB3D4E5", "to-rev"],
    ["abc", "from-rev"],
  ])("refuses %s on --%s before any request, as a usage error", async (value, flag) => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" }, flags: { [flag]: value } });

    const error: unknown = await runDocDiff(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    // Names the flag the caller typed, not the query parameter it maps to.
    expect(String(error)).toContain(`--${flag} must be a commit sha`);
    expect(stub.requests).toHaveLength(0);
  });

  it("accepts an abbreviated sha, which is a sha", async () => {
    const stub = await startStubServer(jsonResponder(200, diff()));
    await runDocDiff(
      stubContext(stub, { args: { id: "doc_a1b2c3" }, flags: { "from-rev": "0a1b2c3" } }).context,
    );

    expect(query(stub.requests[0])).toEqual({ from: "0a1b2c3" });
  });

  it("leaves a well-formed sha this workspace lacks to the server's 400", async () => {
    const stub = await startStubServer(
      jsonResponder(400, {
        code: "bad_request",
        message: "request failed validation",
        issues: [{ path: "query.from", message: `${FROM} is not a commit in this workspace` }],
      }),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" }, flags: { "from-rev": FROM } });

    const error: unknown = await runDocDiff(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(stub.requests).toHaveLength(1);
  });

  it("treats an unknown id as the shipped 404 — exit 5, message verbatim", async () => {
    const stub = await startStubServer(
      jsonResponder(404, { code: "not_found", message: "no document with id doc_nope" }),
    );
    const harness = stubContext(stub, { args: { id: "doc_nope" } });

    const error: unknown = await runDocDiff(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("404 not_found: no document with id doc_nope");
  });
});

describe("the doc diff command spec", () => {
  it("keeps the topic a valid registry topic and is reachable as `corpus doc diff`", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [docTopic] })).toEqual(
      [],
    );
    expect(docTopic.commands.map((command) => command.name)).toContain("diff");
  });

  it("takes the document id and declares a flag for each range half, and only those", () => {
    expect(diffCommand.args.map((arg) => ({ name: arg.name, required: arg.required }))).toEqual([
      { name: "id", required: true },
    ]);
    expect(diffCommand.flags.map((flag) => flag.name)).toEqual(["from-rev", "to-rev"]);
  });

  it("shadows no global flag — which is why the range halves carry the -rev suffix", () => {
    // `--from` is the global actor flag; a range half spelled that way would be
    // parsed as `user|agent` and rejected before this verb ever ran.
    expect(GLOBAL_FLAG_NAMES.has("from")).toBe(true);
    for (const flag of diffCommand.flags) {
      expect(GLOBAL_FLAG_NAMES.has(flag.name)).toBe(false);
    }
  });

  it("documents the properties the agent depends on", () => {
    expect(diffCommand.description).toContain("verbatim");
    expect(diffCommand.description).toContain("doc.edited");
    expect(diffCommand.description).toContain("truncated at a hunk boundary");
    expect(diffCommand.description).toContain("exits 0");
    expect(diffCommand.flags[0]?.description).toContain("global flag");
  });

  it("carries the bare call and a range taken from an event as examples", () => {
    const commands = diffCommand.examples.map((example) => example.command);
    expect(commands).toContain("corpus doc diff doc_a1b2c3");
    expect(commands.some((command) => command.includes("--from-rev"))).toBe(true);
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = diffCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"truncated"');
    expect(machine?.description).toContain('"totalChars"');
  });
});
