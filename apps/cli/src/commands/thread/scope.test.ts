import { SCOPE_PAGE_SIZE, ThreadScopeSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ServerResponseError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { threadTopic } from "./index.js";
import { EMPTY_SCOPE_NOTE, runThreadScope, scopeCommand, TRUNCATION_NOTICE } from "./scope.js";

/**
 * `corpus thread scope` is a **read**, and this file keeps it one: nothing below
 * sends anything, the order asserted is the server's own, and every rendering is
 * asserted against a body the server produced rather than against anything
 * derived here (SPEC.md §7 — scope is computed by the walk that routes the
 * queue, never re-derived by a reader).
 */

const ARGS = { id: "th_2aninur5" };

/** A real response body, as the server answered it during SERVER-130's E2E. */
const LISTING = {
  thread: "th_2aninur5",
  members: [
    {
      id: "th_2aninur5",
      kind: "thread",
      title: "Please take this on @agent",
      status: "open",
      via: "self",
    },
    { id: "doc_aefyz2pg", kind: "doc", title: "Findings", status: "archived", via: "origin" },
    { id: "th_sx5z7cnm", kind: "thread", title: "Re: Findings", status: "open", via: "parent" },
  ],
  truncated: false,
};

afterEach(closeStubServers);

describe("corpus thread scope", () => {
  it("prints one padded line per member, in the order the server sent them", async () => {
    const stub = await startStubServer(jsonResponder(200, LISTING));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.path).toBe("/api/threads/th_2aninur5/scope");
    expect(harness.stdout().split("\n").filter(Boolean)).toEqual([
      "th_2aninur5   thread  open      self    Please take this on @agent",
      "doc_aefyz2pg  doc     archived  origin  Findings",
      "th_sx5z7cnm   thread  open      parent  Re: Findings",
    ]);
  });

  it("renders a body the contract actually admits, not a shape invented here", () => {
    expect(ThreadScopeSchema.safeParse(LISTING).success).toBe(true);
  });

  it("puts the root first and says it is the root, since that is the lane's name", async () => {
    const stub = await startStubServer(jsonResponder(200, LISTING));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    const [first] = harness.stdout().split("\n");
    expect(first).toContain(LISTING.thread);
    expect(first).toContain("self");
  });

  it("names every member's kind, status and edge, so nothing has to be guessed", async () => {
    const stub = await startStubServer(jsonResponder(200, LISTING));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    const rows = harness.stdout().split("\n").filter(Boolean);
    // An archived document is still in scope, and its row is where a reader
    // learns it is archived — archiving touches neither origin nor parent.
    expect(rows[1]).toContain("archived");
    expect(rows[1]).toContain("doc");
    expect(rows[1]).toContain("origin");
    expect(rows[2]).toContain("parent");
  });

  it("never prints a body, only the address and the fields worth branching on", async () => {
    const stub = await startStubServer(jsonResponder(200, LISTING));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    // §7's retrieval discipline. The five columns the contract publishes and
    // nothing else — no excerpt, no turn, no prose fetched per member.
    for (const row of harness.stdout().split("\n").filter(Boolean)) {
      expect(row.split(/\s{2,}/)).toHaveLength(5);
    }
    expect(stub.requests).toHaveLength(1);
  });

  it("says when the listing was cut, and that there is no next page", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...LISTING, truncated: true }));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    const lines = harness.stdout().split("\n").filter(Boolean);
    expect(lines.at(-1)).toBe(TRUNCATION_NOTICE);
    // The bound is named, so a reader knows what "more" is measured against.
    expect(TRUNCATION_NOTICE).toContain(String(SCOPE_PAGE_SIZE));
    // And the remedy is reading by id, not a flag this verb does not have.
    expect(TRUNCATION_NOTICE).toContain("no next page");
    expect(scopeCommand.flags).toEqual([]);
  });

  it("adds no tally when nothing was cut, because the listing is then the whole set", async () => {
    const stub = await startStubServer(jsonResponder(200, LISTING));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    expect(harness.stdout().split("\n").filter(Boolean)).toHaveLength(LISTING.members.length);
    expect(harness.stdout()).not.toContain("showing");
  });

  it("emits the listing verbatim under --json and derives nothing into it", async () => {
    const stub = await startStubServer(jsonResponder(200, LISTING));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runThreadScope(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(LISTING)}\n`);
    expect(harness.stderr()).toBe("");
  });

  it("keeps the truncation notice out of the machine value", async () => {
    const truncated = { ...LISTING, truncated: true };
    const stub = await startStubServer(jsonResponder(200, truncated));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runThreadScope(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(truncated)}\n`);
    expect(harness.stdout()).not.toContain("no next page");
  });

  it("collapses a title that spans lines, so a member is one line", async () => {
    const messy = {
      ...LISTING,
      members: [{ ...LISTING.members[0], title: "Please\n  take   this on" }],
    };
    const stub = await startStubServer(jsonResponder(200, messy));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    expect(harness.stdout().split("\n").filter(Boolean)).toHaveLength(1);
    expect(harness.stdout()).toContain("Please take this on");
  });

  it("gives an untitled member the same word `corpus doc list` uses", async () => {
    const untitled = { ...LISTING, members: [{ ...LISTING.members[0], title: "" }] };
    const stub = await startStubServer(jsonResponder(200, untitled));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    expect(harness.stdout()).toContain("(untitled)");
  });

  it("reports an empty listing as a fault rather than as a resident owning nothing", async () => {
    // The root is always a member and an undesignated thread is a 409, so no
    // legitimate scope is empty — printing silence would read as "it owns
    // nothing", which is a different and false fact.
    const stub = await startStubServer(jsonResponder(200, { ...LISTING, members: [] }));

    const harness = stubContext(stub, { args: ARGS });
    await runThreadScope(harness.context);

    expect(harness.stdout()).toBe("");
    expect(harness.stderr()).toContain(EMPTY_SCOPE_NOTE);
  });

  it("renders the server's 409 for a thread with no resident, in the ordinary error shape", async () => {
    // §7 defines scope only for a designated thread, so this is a refusal rather
    // than an empty listing — and the CLI states no second opinion about it.
    const stub = await startStubServer(
      jsonResponder(409, {
        code: "conflict",
        message: "the orchestrator's lane is not a scope: designate a resident first",
      }),
    );

    const harness = stubContext(stub, { args: ARGS });
    const thrown = await runThreadScope(harness.context).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServerResponseError);
    expect((thrown as ServerResponseError).message).toBe(
      "409 conflict: the orchestrator's lane is not a scope: designate a resident first",
    );
    expect(harness.stdout()).toBe("");
  });

  it("renders the server's 404 for an id that names nothing", async () => {
    const stub = await startStubServer(
      jsonResponder(404, { code: "not_found", message: "no thread th_2aninur5" }),
    );

    const harness = stubContext(stub, { args: ARGS });
    const thrown = await runThreadScope(harness.context).catch((error: unknown) => error);

    expect((thrown as ServerResponseError).message).toContain("no thread th_2aninur5");
  });
});

describe("the scope command spec", () => {
  it("keeps the thread topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [threadTopic] })).toEqual(
      [],
    );
  });

  it("is reachable as `corpus thread scope`", () => {
    expect(threadTopic.commands.map((command) => command.name)).toContain("scope");
  });

  it("takes one required thread id and no flags of its own", () => {
    expect(scopeCommand.args).toEqual([
      { name: "id", required: true, description: "The designated thread's id." },
    ]);
    // The bound is the contract's, so there is nothing to widen it with: a
    // cursor here would turn it into the enumeration §7 forbids.
    expect(scopeCommand.flags).toEqual([]);
    expect(scopeCommand.description).not.toContain("--limit");
    expect(scopeCommand.description).not.toContain("--offset");
  });

  it("documents the bound, the refusal and the three edges a member arrives by", () => {
    expect(scopeCommand.description).toContain(String(SCOPE_PAGE_SIZE));
    expect(scopeCommand.description).toContain("`409`");
    for (const via of ["`self`", "`parent`", "`origin`"]) {
      expect(scopeCommand.description, via).toContain(via);
    }
    // The two facts a reader gets wrong by default: an archived document is
    // still owned, and a document written before the designation is too.
    expect(scopeCommand.description).toContain("archived document is still in scope");
    expect(scopeCommand.description).toContain("before the thread was designated");
  });

  it("says reading your own lane is not a sweep, which is why the agent has this verb", () => {
    // CONTRACT-068 decision 4, decided 2026-08-19. Without the sentence, §7's
    // retrieval discipline reads as forbidding the one listing a resident is
    // entitled to.
    expect(scopeCommand.description).toContain("reading your own lane is not a sweep");
  });
});
