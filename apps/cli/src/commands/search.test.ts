import { SEMANTIC_INDEX_STATES, type SearchHit, type SearchResults } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../errors.js";
import { collectRegistryProblems } from "../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../testing/stub-server.js";
import { runSearch, searchCommand } from "./search.js";

/**
 * The property that carries this verb is **frugality, and its stability**: one
 * line per hit, id first, no body, and a shape an agent can read positionally
 * (SPEC.md §7). The exact-output assertion below is the parse target the
 * product's own skills quote, so changing it is a documentation break, not a
 * formatting choice.
 */

const hit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  id: "doc_a1b2c3",
  title: "Mortgage options",
  headingPath: "Mortgage options › Rates",
  snippet: "…the rate lock deadline is 30 June…",
  ...overrides,
});

const results = (hits: readonly SearchHit[], semanticIndex?: string): SearchResults =>
  ({ hits, ...(semanticIndex === undefined ? {} : { semanticIndex }) }) as SearchResults;

const query = (request: { readonly query: URLSearchParams } | undefined): Record<string, string> =>
  Object.fromEntries(request?.query ?? new URLSearchParams());

afterEach(closeStubServers);

describe("corpus search", () => {
  it("reads the ranked retrieval route, sending the query and nothing it was not given", async () => {
    const stub = await startStubServer(jsonResponder(200, results([hit()])));
    const harness = stubContext(stub, { args: { query: "rate assumptions" } });

    await runSearch(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/search");
    expect(query(stub.requests[0])).toEqual({ q: "rate assumptions" });
  });

  it("prints one padded line per hit — id, heading path, snippet — and nothing else", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        results([
          hit(),
          hit({
            id: "th_x9y8",
            title: "Rate assumptions",
            headingPath: "Rate assumptions › user · 2026-07-28T10:00:00Z",
            snippet: "…we assumed 6.1% for the whole term…",
          }),
        ]),
      ),
    );
    const harness = stubContext(stub, { args: { query: "rate" } });

    await runSearch(harness.context);

    expect(harness.stdout()).toBe(
      [
        "doc_a1b2c3  Mortgage options › Rates                        …the rate lock deadline is 30 June…",
        "th_x9y8     Rate assumptions › user · 2026-07-28T10:00:00Z  …we assumed 6.1% for the whole term…",
        "",
      ].join("\n"),
    );
  });

  it("never prints a body, however large the matching document is", async () => {
    // The frugality is the server's contract; what the CLI guarantees is that it
    // prints the four fields it was given and invents no fifth.
    const stub = await startStubServer(jsonResponder(200, results([hit()])));
    const harness = stubContext(stub, { args: { query: "rate" } });

    await runSearch(harness.context);

    const lines = harness.stdout().trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBeLessThan(200);
  });

  it("keeps a hit on one line even if the snippet arrives with newlines in it", async () => {
    const stub = await startStubServer(
      jsonResponder(200, results([hit({ snippet: "first\nsecond   third\n" })])),
    );
    const harness = stubContext(stub, { args: { query: "rate" } });

    await runSearch(harness.context);

    expect(harness.stdout()).toBe("doc_a1b2c3  Mortgage options › Rates  first second third\n");
  });

  it("passes the shared structured filters through verbatim, with the cap", async () => {
    const stub = await startStubServer(jsonResponder(200, results([])));
    const harness = stubContext(stub, {
      args: { query: "mortgage" },
      flags: {
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
        "include-archived": true,
        unread: true,
        limit: 5,
      },
    });

    await runSearch(harness.context);

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
      includeArchived: "true",
      unread: "true",
      limit: "5",
    });
  });

  it("refuses a misspelled enumerated filter without sending a request", async () => {
    const stub = await startStubServer(jsonResponder(200, results([])));
    const harness = stubContext(stub, { args: { query: "x" }, flags: { status: "closed" } });

    const error: unknown = await runSearch(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("open, resolved, archived");
    expect(stub.requests).toHaveLength(0);
  });

  it("reports an empty ranking honestly, and exits 0", async () => {
    const stub = await startStubServer(jsonResponder(200, results([])));
    const harness = stubContext(stub, { args: { query: "unobtainium" } });

    await runSearch(harness.context);

    expect(harness.stdout()).toBe("no documents match.\n");
  });

  it("emits the server's envelope unchanged under --json, and no human line", async () => {
    const body = results([hit()], "current");
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, { args: { query: "rate" }, json: true });

    await runSearch(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(body)}\n`);
    expect(harness.stdout()).not.toContain("Mortgage options › Rates  ");
  });

  it("says nothing about ranking while the semantic index is current or absent", async () => {
    for (const body of [results([hit()]), results([hit()], "current")]) {
      const stub = await startStubServer(jsonResponder(200, body));
      const harness = stubContext(stub, { args: { query: "rate" } });

      await runSearch(harness.context);

      expect(harness.stdout()).not.toContain("#");
      expect(harness.stdout()).not.toContain("degraded");
    }
  });

  it("warns once, above the results, when the server flags degraded ranking", async () => {
    const stub = await startStubServer(jsonResponder(200, results([hit()], "indexing")));
    const harness = stubContext(stub, { args: { query: "rate" } });

    await runSearch(harness.context);

    const lines = harness.stdout().trimEnd().split("\n");
    expect(lines[0]).toContain("# ranking is degraded");
    expect(lines[0]).toContain("indexing");
    // The note never becomes a hit: the parse target is still one line per hit.
    expect(lines).toHaveLength(2);
    expect(lines[1]?.startsWith("doc_a1b2c3")).toBe(true);
  });

  // Phase B produces these three for real — a rebuild in flight, an incremental
  // backlog, and no usable index at all — and the wording stays one generic line
  // for all of them on purpose (`retrieval.ts`): an unknown state must read as
  // degraded too, so nothing here matches the value exhaustively.
  it.each(SEMANTIC_INDEX_STATES.filter((state) => state !== "current"))(
    "warns on the wire value %s, and names it",
    async (state) => {
      const stub = await startStubServer(jsonResponder(200, results([hit()], state)));
      const harness = stubContext(stub, { args: { query: "rate" } });

      await runSearch(harness.context);

      const [first] = harness.stdout().split("\n");
      expect(first).toContain("# ranking is degraded");
      expect(first).toContain(state);
    },
  );

  it("keeps the note out of --json, where the state is already a field", async () => {
    const body = results([hit()], "stale");
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, { args: { query: "rate" }, json: true });

    await runSearch(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(body)}\n`);
  });

  it("surfaces a server refusal as the shipped server error, exit 5", async () => {
    const stub = await startStubServer(
      jsonResponder(400, { code: "bad_request", message: "q must not be empty", issues: [] }),
    );
    const harness = stubContext(stub, { args: { query: " " } });

    const error: unknown = await runSearch(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("400 bad_request: q must not be empty");
  });
});

describe("the search command spec", () => {
  it("is a valid top-level command that shadows no global flag", () => {
    expect(
      collectRegistryProblems({ summary: "s.", commands: [searchCommand], topics: [] }),
    ).toEqual([]);
    const names = searchCommand.flags.map((flag) => flag.name);
    expect(names).not.toContain("json");
    expect(names).not.toContain("workspace");
  });

  it("takes the query as its one required positional", () => {
    expect(searchCommand.args.map((arg) => ({ name: arg.name, required: arg.required }))).toEqual([
      { name: "query", required: true },
    ]);
    expect(searchCommand.args[0]?.description).toContain("look for");
  });

  it("declares a flag for every filter it sends", () => {
    const declared = new Set(searchCommand.flags.map((flag) => flag.name));
    for (const filter of [
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
      "due",
      "since",
      "stale",
      "limit",
    ]) {
      expect(declared, `--${filter} is undeclared`).toContain(filter);
    }
  });

  it("documents that reading a hit is a separate act, and names the verb that does it", () => {
    expect(searchCommand.description).toContain("corpus doc show <id>");
    expect(searchCommand.description).toContain("Never a body");
    expect(searchCommand.examples.some((e) => e.description.includes("corpus doc show <id>"))).toBe(
      true,
    );
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = searchCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"hits"');
    expect(machine?.description).toContain('"headingPath"');
  });
});
