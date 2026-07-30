import type { DocList } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { docTopic } from "./index.js";
import { DOC_ROW, row } from "./fixtures.js";
import { listCommand, runDocList } from "./list.js";

/**
 * Two properties carry this verb, and both are about honesty rather than
 * plumbing: a page must never read as the whole set (the agent files documents
 * from this output), and a filter must reach the wire exactly as typed or not at
 * all — a silently dropped filter returns a plausible, wrong list.
 */

const page = (items: DocList["items"], meta: Partial<DocList["page"]> = {}): DocList => ({
  items,
  page: { total: items.length, limit: 50, offset: 0, ...meta },
});

const EMPTY = page([]);

const query = (request: { readonly query: URLSearchParams } | undefined): Record<string, string> =>
  Object.fromEntries(request?.query ?? new URLSearchParams());

afterEach(closeStubServers);

describe("corpus doc list", () => {
  it("reads the shipped collection route and sends no query when nothing was filtered", async () => {
    const stub = await startStubServer(jsonResponder(200, page([DOC_ROW])));
    const harness = stubContext(stub);

    await runDocList(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/docs");
    expect(query(stub.requests[0])).toEqual({});
  });

  it("prints one padded row per document, then the tally", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        page([
          DOC_ROW,
          row({
            id: "doc_zz",
            type: "skill",
            status: "archived",
            title: "Weekly review",
            path: ".claude/skills/weekly-review/SKILL.md",
          }),
        ]),
      ),
    );
    const harness = stubContext(stub);

    await runDocList(harness.context);

    expect(harness.stdout()).toBe(
      [
        "doc_a1b2c3  note   open      Mortgage options  data/docs/finance/mortgage-options.md",
        "doc_zz      skill  archived  Weekly review     .claude/skills/weekly-review/SKILL.md",
        "showing 1–2 of 2 documents",
        "",
      ].join("\n"),
    );
  });

  it("names the offset that fetches the next page rather than truncating silently", async () => {
    const stub = await startStubServer(
      jsonResponder(200, page([DOC_ROW], { total: 137, limit: 1, offset: 0 })),
    );
    const harness = stubContext(stub);

    await runDocList(harness.context);

    expect(harness.stdout()).toContain("showing 1–1 of 137 documents — next page: --offset 1");
  });

  it("states the range it is on when reading a later page", async () => {
    const stub = await startStubServer(
      jsonResponder(200, page([DOC_ROW], { total: 3, limit: 50, offset: 2 })),
    );
    const harness = stubContext(stub, { flags: { offset: 2 } });

    await runDocList(harness.context);

    expect(query(stub.requests[0])).toEqual({ offset: "2" });
    expect(harness.stdout()).toContain("showing 3–3 of 3 documents");
    expect(harness.stdout()).not.toContain("next page");
  });

  it("passes every documented filter through verbatim", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, {
      flags: {
        q: "mortgage",
        type: "note,view",
        tag: "finance",
        folder: "finance",
        status: "open",
        parent: "doc_a1b2c3",
        references: "doc_zz",
        agent: "engaged",
        author: "agent",
        since: "2026-07-01T00:00:00Z",
        due: "week",
        stale: "aging",
        needs: "unread-reply",
        sort: "title",
        limit: 10,
        offset: 20,
      },
    });

    await runDocList(harness.context);

    expect(query(stub.requests[0])).toEqual({
      q: "mortgage",
      type: "note,view",
      tag: "finance",
      folder: "finance",
      status: "open",
      parent: "doc_a1b2c3",
      references: "doc_zz",
      agent: "engaged",
      author: "agent",
      since: "2026-07-01T00:00:00Z",
      due: "week",
      stale: "aging",
      needs: "unread-reply",
      sort: "title",
      limit: "10",
      offset: "20",
    });
  });

  it("sends the boolean filters only when they were asked for", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));

    await runDocList(stubContext(stub, { flags: { unread: false } }).context);
    expect(query(stub.requests[0])).toEqual({});

    await runDocList(
      stubContext(stub, {
        flags: { "include-archived": true, unread: true, pinned: true },
      }).context,
    );
    expect(query(stub.requests[1])).toEqual({
      includeArchived: "true",
      unread: "true",
      pinned: "true",
    });
  });

  it("lists skills, which is the discovery gap the verb was filed for", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        page([
          row({
            id: "doc_wy3a54lf",
            type: "skill",
            title: "weekly-review",
            path: ".claude/skills/weekly-review/SKILL.md",
          }),
        ]),
      ),
    );
    const harness = stubContext(stub, { flags: { type: "skill" } });

    await runDocList(harness.context);

    expect(query(stub.requests[0])).toEqual({ type: "skill" });
    expect(harness.stdout()).toContain(".claude/skills/weekly-review/SKILL.md");
  });

  it("refuses a misspelled enumerated filter without sending a request", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, { flags: { status: "closed" } });

    const error: unknown = await runDocList(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("open, resolved, archived");
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    ["sort", "newest"],
    ["needs", "everything"],
    ["stale", "ancient"],
    ["agent", "busy"],
    ["author", "robot"],
  ])("refuses a bad --%s the same way", async (flag, value) => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, { flags: { [flag]: value } });

    const error: unknown = await runDocList(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain(`--${flag} must be one of`);
    expect(stub.requests).toHaveLength(0);
  });

  it("reports an empty collection honestly, and exits 0", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub);

    await runDocList(harness.context);

    expect(harness.stdout()).toBe("no documents match.\n");
  });

  it("distinguishes an empty page from an empty collection", async () => {
    const stub = await startStubServer(
      jsonResponder(200, page([], { total: 12, limit: 50, offset: 90 })),
    );
    const harness = stubContext(stub, { flags: { offset: 90 } });

    await runDocList(harness.context);

    expect(harness.stdout()).toBe("no documents on this page.\n");
  });

  it("emits the server's envelope unchanged under --json, page meta and extra included", async () => {
    const body = page([row({ extra: { "todo.items": [{ text: "call the broker" }] } })], {
      total: 137,
    });
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, { json: true });

    await runDocList(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(body);
    // The truncation stays visible to a machine caller too: `page` is the only
    // thing that says 137 matched and 1 was returned.
    expect(JSON.parse(harness.stdout())).toMatchObject({ page: { total: 137 } });
  });

  it("emits an empty result under --json without a human line", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, { json: true });

    await runDocList(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ items: [], page: EMPTY.page });
    expect(harness.stdout()).not.toContain("no documents");
  });

  it("collapses a multi-line title and cuts an overlong one, keeping one row per document", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        page([
          row({ id: "doc_1", title: "A title\nwith a newline" }),
          row({ id: "doc_2", title: "x".repeat(200) }),
          row({ id: "doc_3", title: "   " }),
        ]),
      ),
    );
    const harness = stubContext(stub);

    await runDocList(harness.context);

    const lines = harness.stdout().trimEnd().split("\n");
    expect(lines).toHaveLength(4); // three rows plus the tally
    expect(lines[0]).toContain("A title with a newline");
    expect(lines[1]).toContain(`${"x".repeat(59)}…`);
    expect(lines[2]).toContain("(untitled)");
  });

  it("surfaces the server's refusal of `sort=relevance` without `q` verbatim", async () => {
    const stub = await startStubServer(
      jsonResponder(400, {
        code: "bad_request",
        message: "`sort=relevance` is only meaningful with a `q` query.",
        issues: [{ path: "query.sort", message: "requires q" }],
      }),
    );
    const harness = stubContext(stub, { flags: { sort: "relevance" } });

    const error: unknown = await runDocList(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("only meaningful with a `q` query");
  });
});

describe("the doc list command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [docTopic] })).toEqual(
      [],
    );
  });

  it("takes no positional and shadows no global flag", () => {
    expect(listCommand.args).toEqual([]);
    expect(listCommand.flags.map((flag) => flag.name)).not.toContain("json");
    expect(listCommand.flags.map((flag) => flag.name)).not.toContain("workspace");
  });

  it("declares a flag for every filter it sends", () => {
    const declared = new Set(listCommand.flags.map((flag) => flag.name));
    for (const filter of [
      "q",
      "type",
      "tag",
      "folder",
      "status",
      "include-archived",
      "needs",
      "parent",
      "references",
      "agent",
      "author",
      "unread",
      "pinned",
      "due",
      "since",
      "stale",
      "sort",
      "limit",
      "offset",
    ]) {
      expect(declared, `--${filter} is undeclared`).toContain(filter);
    }
  });

  it("documents the pagination and is reachable as `corpus doc list`", () => {
    expect(listCommand.description).toContain("paginated");
    expect(listCommand.description).toContain("--offset");
    expect(docTopic.commands.map((command) => command.name)).toContain("list");
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = listCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"items"');
    expect(machine?.description).toContain('"page"');
  });
});
