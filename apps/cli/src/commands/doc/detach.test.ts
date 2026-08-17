import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { detachCommand, runDocDetach } from "./detach.js";
import { DOC } from "./fixtures.js";
import { docTopic } from "./index.js";

const ARGS = { id: "doc_a1b2c3" };

afterEach(closeStubServers);

/**
 * CLI-044's detach verb: SPEC.md §9.2's one exception to "a caller never touches
 * an origin" — and the exception is **clear only**, enforced by the server
 * rather than pre-checked here.
 */
describe("corpus doc detach", () => {
  it("sends the clear-only edit, and nothing else", async () => {
    // The whole request is `origin: null`. Anything more would be this verb
    // deciding something about the document it was not asked to decide.
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { doc: DOC, anchors: { remapped: [], orphaned: [] }, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, flags: {} });

    await runDocDetach(harness.context);

    const put = stub.requests[0];
    expect(put?.method).toBe("PUT");
    expect(put?.path).toBe("/api/docs/doc_a1b2c3");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ origin: null });
  });

  it("offers no flag that could set an origin", () => {
    // There is none anywhere in the CLI: an origin is recorded from the `job` a
    // write names. Pinned so a later convenience does not quietly add one and
    // hand callers the caller-asserted scope membership the split exists to
    // make unexpressible.
    expect(detachCommand.flags).toEqual([]);
  });

  it("is a verb of the doc topic", () => {
    expect(docTopic.commands).toContain(detachCommand);
  });

  it("says it is a correction rather than a lock, where a caller will read it", () => {
    // §9.2: a detached document may be claimed again by a later write naming a
    // job. Someone who read this as sealing the document would be surprised
    // later, and the surprise would look like the app ignoring them.
    expect(detachCommand.description).toMatch(/correction rather than a lock/i);
    expect(detachCommand.description).toMatch(/user-only/i);
  });
});
