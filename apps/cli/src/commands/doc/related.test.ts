import type { RelatedDoc, RelatedDocs } from "@corpus/contract";
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
import { relatedCommand, runDocRelated } from "./related.js";

/**
 * The expansion half of retrieval: one line per neighbour, the same frugal shape
 * a search hit prints, and an id the agent can hand straight to `corpus doc
 * show` — which is the whole reason the server never offers a dangling one.
 */

const related = (overrides: Partial<RelatedDoc> = {}): RelatedDoc => ({
  id: "th_x9y8",
  title: "Rate assumptions",
  excerpt: "Locking at 6.1% assumes the survey lands before June.",
  relation: "linked",
  ...overrides,
});

const envelope = (docs: readonly RelatedDoc[], semanticIndex?: string): RelatedDocs =>
  ({ related: docs, ...(semanticIndex === undefined ? {} : { semanticIndex }) }) as RelatedDocs;

const query = (request: { readonly query: URLSearchParams } | undefined): Record<string, string> =>
  Object.fromEntries(request?.query ?? new URLSearchParams());

afterEach(closeStubServers);

describe("corpus doc related", () => {
  it("reads the related route for the given id, sending no query it was not given", async () => {
    const stub = await startStubServer(jsonResponder(200, envelope([related()])));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocRelated(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/docs/doc_a1b2c3/related");
    expect(query(stub.requests[0])).toEqual({});
  });

  it("prints one padded line per neighbour — id, relation, excerpt", async () => {
    const stub = await startStubServer(
      jsonResponder(
        200,
        envelope([
          related(),
          related({
            id: "doc_zz",
            title: "Weekly review",
            excerpt: "Standing agenda for the Monday review.",
          }),
        ]),
      ),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocRelated(harness.context);

    expect(harness.stdout()).toBe(
      [
        "th_x9y8  linked  Locking at 6.1% assumes the survey lands before June.",
        "doc_zz   linked  Standing agenda for the Monday review.",
        "",
      ].join("\n"),
    );
  });

  it("keeps a neighbour on one line even if its excerpt arrives with newlines", async () => {
    const stub = await startStubServer(
      jsonResponder(200, envelope([related({ excerpt: "first\nsecond  third" })])),
    );
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocRelated(harness.context);

    expect(harness.stdout()).toBe("th_x9y8  linked  first second third\n");
  });

  it("sends the cap and the archived flag when they were asked for", async () => {
    const stub = await startStubServer(jsonResponder(200, envelope([])));

    await runDocRelated(
      stubContext(stub, {
        args: { id: "doc_a1b2c3" },
        flags: { limit: 3, "include-archived": true },
      }).context,
    );

    expect(query(stub.requests[0])).toEqual({ limit: "3", includeArchived: "true" });
  });

  it("omits the archived flag on its false side, as every list does", async () => {
    const stub = await startStubServer(jsonResponder(200, envelope([])));

    await runDocRelated(
      stubContext(stub, { args: { id: "doc_a1b2c3" }, flags: { "include-archived": false } })
        .context,
    );

    expect(query(stub.requests[0])).toEqual({});
  });

  it("reports a document nothing relates to honestly, and exits 0", async () => {
    const stub = await startStubServer(jsonResponder(200, envelope([])));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" } });

    await runDocRelated(harness.context);

    expect(harness.stdout()).toBe("no related documents.\n");
  });

  it("emits the server's envelope unchanged under --json, and no human line", async () => {
    const body = envelope([related()], "current");
    const stub = await startStubServer(jsonResponder(200, body));
    const harness = stubContext(stub, { args: { id: "doc_a1b2c3" }, json: true });

    await runDocRelated(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(body)}\n`);
  });

  it("says nothing about ranking in Phase A, and warns when the server flags it", async () => {
    const quiet = await startStubServer(jsonResponder(200, envelope([related()])));
    const quietHarness = stubContext(quiet, { args: { id: "doc_a1b2c3" } });
    await runDocRelated(quietHarness.context);
    expect(quietHarness.stdout()).not.toContain("#");

    const loud = await startStubServer(jsonResponder(200, envelope([related()], "disabled")));
    const loudHarness = stubContext(loud, { args: { id: "doc_a1b2c3" } });
    await runDocRelated(loudHarness.context);
    expect(loudHarness.stdout().split("\n")[0]).toContain("# ranking is degraded");
  });

  it("treats an unknown id as the shipped 404 — exit 5, message verbatim", async () => {
    const stub = await startStubServer(
      jsonResponder(404, { code: "not_found", message: "no document with id doc_nope" }),
    );
    const harness = stubContext(stub, { args: { id: "doc_nope" } });

    const error: unknown = await runDocRelated(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("404 not_found: no document with id doc_nope");
  });
});

describe("the doc related command spec", () => {
  it("keeps the topic a valid registry topic and is reachable as `corpus doc related`", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [docTopic] })).toEqual(
      [],
    );
    expect(docTopic.commands.map((command) => command.name)).toContain("related");
  });

  it("takes the document id and shadows no global flag", () => {
    expect(relatedCommand.args.map((arg) => ({ name: arg.name, required: arg.required }))).toEqual([
      { name: "id", required: true },
    ]);
    expect(relatedCommand.args[0]?.description).toContain("expand from");
    const names = relatedCommand.flags.map((flag) => flag.name);
    expect(names).not.toContain("json");
    expect(names).not.toContain("workspace");
  });

  it("declares a flag for every parameter it sends, and only those", () => {
    expect(relatedCommand.flags.map((flag) => flag.name)).toEqual(["limit", "include-archived"]);
  });

  it("documents that reading a neighbour is a separate act", () => {
    expect(relatedCommand.description).toContain("corpus doc show <id>");
    expect(relatedCommand.description).toContain("never a body");
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = relatedCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"related"');
    expect(machine?.description).toContain('"relation"');
  });
});
