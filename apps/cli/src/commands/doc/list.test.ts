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
        flags: { "include-archived": true, unread: true },
      }).context,
    );
    expect(query(stub.requests[1])).toEqual({
      includeArchived: "true",
      unread: "true",
    });
  });

  /**
   * CLI-032. `isParent` is the one filter on this verb where `false` is a real
   * question ("the children") rather than the absence of one, so the three-way
   * distinction is the property worth testing: `true`, `false` and absent must
   * reach the wire as three different requests. A bare boolean flag would fold
   * `false` into absent and answer a caller asking for children with everything.
   */
  describe("--is-parent", () => {
    it.each([
      ["true", "true"],
      ["false", "false"],
    ])("sends is-parent %s as isParent=%s", async (given, sent) => {
      const stub = await startStubServer(jsonResponder(200, EMPTY));

      await runDocList(stubContext(stub, { flags: { "is-parent": given } }).context);

      expect(query(stub.requests[0])).toEqual({ isParent: sent });
    });

    it("sends nothing when it is absent, so an existing command line is untouched", async () => {
      const stub = await startStubServer(jsonResponder(200, EMPTY));

      await runDocList(stubContext(stub, { flags: { type: "note" } }).context);

      expect(query(stub.requests[0])).toEqual({ type: "note" });
    });

    it("is a distinct request from the false one, not the same absence", async () => {
      const stub = await startStubServer(jsonResponder(200, EMPTY));

      await runDocList(stubContext(stub, { flags: {} }).context);
      await runDocList(stubContext(stub, { flags: { "is-parent": "false" } }).context);

      expect(query(stub.requests[0])).not.toEqual(query(stub.requests[1]));
    });

    it("refuses a value that is neither, without sending a request", async () => {
      const stub = await startStubServer(jsonResponder(200, EMPTY));
      const harness = stubContext(stub, { flags: { "is-parent": "root" } });

      const error: unknown = await runDocList(harness.context).catch((cause: unknown) => cause);

      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(String(error)).toContain("is-parent");
      expect(stub.requests).toHaveLength(0);
    });

    /**
     * The contradiction `parent=<id>&isParent=true` is the server's `400`, and
     * deliberately not re-implemented here: the CLI is a thin typed-client call,
     * and a second copy of the rule is a copy that can disagree with the one
     * that decides.
     */
    it("leaves the --parent contradiction to the server rather than pre-judging it", async () => {
      const stub = await startStubServer(jsonResponder(200, EMPTY));

      await runDocList(
        stubContext(stub, { flags: { parent: "doc_a1b2c3", "is-parent": "true" } }).context,
      );

      expect(query(stub.requests[0])).toEqual({ parent: "doc_a1b2c3", isParent: "true" });
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
      "stage",
      "include-archived",
      "needs",
      "parent",
      "references",
      "agent",
      "author",
      "unread",
      "is-parent",
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

  /**
   * CLI-032. The whole risk in `--is-parent` is its name: a reader who trusts it
   * concludes "documents that have children", which is the reading CONTRACT-042
   * considered and rejected. Help text is where an agent learns what a flag
   * does, so the correction is pinned here — the failure this guards is a later
   * rewrite that "tidies" the description into agreement with the name.
   */
  describe("--is-parent's help text", () => {
    const isParent = (): string =>
      listCommand.flags.find((flag) => flag.name === "is-parent")?.description ?? "";

    it("says it selects roots, in those words", () => {
      expect(isParent()).toContain("selects **roots**");
      expect(isParent()).toContain("no parent");
      expect(isParent()).toContain("top-level only");
    });

    it("denies the reading the name invites, rather than leaving it open", () => {
      expect(isParent()).toContain("does **not** mean");
      expect(isParent()).toContain("_has children_");
      expect(isParent().toLowerCase()).not.toContain("documents that have children");
    });

    it("says absent is not false, since that is the other way to misread it", () => {
      expect(isParent()).toContain("absent is not `false`");
    });

    it("takes a value, so absent and false stay distinguishable", () => {
      const flag = listCommand.flags.find((candidate) => candidate.name === "is-parent");
      expect(flag?.type).toBe("string");
      expect(flag?.valueName).toBe("true|false");
    });

    /**
     * The thread-only note lists which filters no-op for non-thread types. This
     * one does not, so the note has to say so or the list of exceptions is a
     * list a reader can act on wrongly.
     */
    it("is excluded from the description's thread-only note", () => {
      expect(listCommand.description).toContain("`--is-parent` is **not** one of them");
    });
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

describe("corpus doc list --fields (CLI-065)", () => {
  it("cuts each item to the named fields, in the order asked, keeping page whole", async () => {
    const body = page([DOC_ROW, row({ id: "doc_zz", title: "Second" })], { total: 137 });
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, {
      json: true,
      flags: { json: true, fields: "lastActor,id,updated" },
    });

    await runDocList(harness.context);

    const value = JSON.parse(harness.stdout()) as {
      items: Record<string, unknown>[];
      page: unknown;
    };
    // The projection selects exactly the named fields, in the requested order.
    expect(value.items.map((item) => Object.keys(item))).toEqual([
      ["lastActor", "id", "updated"],
      ["lastActor", "id", "updated"],
    ]);
    expect(value.items[0]).toEqual({
      lastActor: DOC_ROW.lastActor,
      id: DOC_ROW.id,
      updated: DOC_ROW.updated,
    });
    // The truncation stays visible: `page` is untouched by the projection.
    expect(value.page).toEqual(body.page);
  });

  it("refuses a field no row carries, naming the known ones, before any request", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, {
      json: true,
      flags: { json: true, fields: "id,excerpts" },
    });

    const failure = await runDocList(harness.context).catch((error: unknown) => error);

    expect(exitCodeFor(failure)).toBe(ExitCode.usageError);
    expect((failure as Error).message).toContain("excerpts");
    expect((failure as Error).message).toContain("1 field no row carries");
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses --fields without --json, before any request", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, { flags: { fields: "id" } });

    const failure = await runDocList(harness.context).catch((error: unknown) => error);

    expect(exitCodeFor(failure)).toBe(ExitCode.usageError);
    expect((failure as Error).message).toContain("--json");
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses a --fields that names nothing", async () => {
    const stub = await startStubServer(jsonResponder(200, EMPTY));
    const harness = stubContext(stub, { json: true, flags: { json: true, fields: " , ," } });

    const failure = await runDocList(harness.context).catch((error: unknown) => error);

    expect(exitCodeFor(failure)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("reads a repeated field once, at the position it was first named", async () => {
    const stub = await startStubServer(jsonResponder(200, page([DOC_ROW])));
    const harness = stubContext(stub, {
      json: true,
      flags: { json: true, fields: "id,title,id" },
    });

    await runDocList(harness.context);

    const value = JSON.parse(harness.stdout()) as { items: Record<string, unknown>[] };
    expect(Object.keys(value.items[0] ?? {})).toEqual(["id", "title"]);
  });

  it("keeps a field a row genuinely lacks absent rather than inventing null", async () => {
    // A projection that turned an absent field into `null` would be inventing
    // an answer — asserted over a raw body rather than the typed `page` helper,
    // because the point is robustness to a row leaner than the compiled shape.
    const { snippets: _omitted, ...bare } = DOC_ROW;
    const stub = await startStubServer(
      jsonResponder(200, { items: [bare], page: { total: 1, limit: 50, offset: 0 } }),
    );
    const harness = stubContext(stub, {
      json: true,
      flags: { json: true, fields: "id,snippets" },
    });

    await runDocList(harness.context);

    const item = (JSON.parse(harness.stdout()) as { items: Record<string, unknown>[] }).items[0];
    expect(item !== undefined && "snippets" in item).toBe(false);
    expect(item?.id).toBe(DOC_ROW.id);
  });

  it("leaves the full --json object exactly as it was when --fields is absent", async () => {
    const body = page([DOC_ROW]);
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, { json: true, flags: { json: true } });

    await runDocList(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(body);
  });

  it("documents the reflection read and validates against the contract's own field list", () => {
    const flag = listCommand.flags.find((candidate) => candidate.name === "fields");
    expect(flag?.description).toContain("lastActor");
    const reflection = listCommand.examples.find((example) => example.command.includes("--fields"));
    expect(reflection?.command).toContain("lastActor");
  });
});
