import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError, renderError } from "../../errors.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
  type StubRequest,
} from "../../testing/stub-server.js";
import { row } from "../doc/fixtures.js";
import { AGENT_REFUSAL, runFolderDelete } from "./delete.js";

afterEach(closeStubServers);

const IN_FOLDER = [
  row({ id: "doc_a1b2c3", path: "data/docs/finance/2024/mortgage.md" }),
  row({ id: "doc_c3d4e5", type: "view", path: "data/docs/finance/2024/nested/rates.md" }),
];

/** A thread on one of those documents: `GET /api/docs?folder=` lists it, the delete does not touch it. */
const THREAD = row({ id: "th_x9y8", type: "thread", path: "data/threads/th_x9y8.md" });

/** A `Finance` document SQLite's case-folding `LIKE` would return for `finance`. */
const OTHER_CASE = row({ id: "doc_ffff", path: "data/docs/Finance/2024/other.md" });

const listing = (items: readonly unknown[], total = items.length) => ({
  items,
  page: { total, limit: 200, offset: 0 },
});

const hint = (error: unknown): string => (isCliError(error) ? (error.hint ?? "") : "");
const details = (error: unknown): unknown => (isCliError(error) ? error.details : undefined);
const human = (error: unknown): string =>
  error instanceof Error ? renderError(error, { verbose: false }) : "";

describe("corpus folder delete — the agent guard", () => {
  it("refuses the agent before anything is sent, naming the verb it should use", async () => {
    const stub = await startStubServer(() => {
      throw new Error("nothing should be sent");
    });
    const harness = stubContext(stub, { args: { path: "finance" }, actor: "agent" });

    const error: unknown = await runFolderDelete(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain(AGENT_REFUSAL);
    expect(hint(error)).toContain("corpus folder archive finance");
    expect(stub.requests).toHaveLength(0);
  });
});

describe("corpus folder delete — the --yes guard", () => {
  it("lists what it would delete and exits 2, having deleted nothing", async () => {
    const stub = await startStubServer((request, response) => {
      sendJson(response, 200, listing([...IN_FOLDER, THREAD, OTHER_CASE]));
    });
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "user" });

    const error: unknown = await runFolderDelete(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("data/docs/finance/2024");
    expect(String(error)).toContain("2 documents");
    // Read-only: the preview is a `GET`, and no delete was posted.
    expect(stub.requests.map((sent: StubRequest) => sent.method)).toEqual(["GET"]);
  });

  it("asks the collection query for the folder, archived documents included", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, listing(IN_FOLDER));
    });
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "user" });

    await runFolderDelete(harness.context).catch(() => undefined);

    const query = stub.requests[0]?.query;
    expect(query?.get("folder")).toBe("finance/2024");
    expect(query?.get("includeArchived")).toBe("true");
    expect(query?.get("limit")).toBe("200");
  });

  it("does not promise to remove threads, which a folder delete leaves standing", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, listing([...IN_FOLDER, THREAD]));
    });
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "user" });

    const error: unknown = await runFolderDelete(harness.context).catch((cause: unknown) => cause);

    expect(human(error)).not.toContain("th_x9y8");
    expect(hint(error)).toContain("orphaned records");
    expect(details(error)).toEqual({ documents: IN_FOLDER });
  });

  it("drops a row the filter matched only by folding case", async () => {
    // SQLite's `LIKE` folds ASCII case; the act compares byte-exactly. The
    // preview must show the set the act would remove, not the set the filter
    // returned.
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, listing([OTHER_CASE]));
    });
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "user" });

    const error: unknown = await runFolderDelete(harness.context).catch((cause: unknown) => cause);

    expect(String(error)).toContain("it holds no documents");
    expect(human(error)).not.toContain("doc_ffff");
  });

  it("pages to the end, because a first page is a confirmation of the wrong thing", async () => {
    const stub = await startStubServer((request, response) => {
      const offset = Number(new URL(request.url, "http://stub.invalid").searchParams.get("offset"));
      const items = offset === 0 ? [IN_FOLDER[0]] : [IN_FOLDER[1]];
      sendJson(response, 200, { items, page: { total: 2, limit: 200, offset } });
    });
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "user" });

    const error: unknown = await runFolderDelete(harness.context).catch((cause: unknown) => cause);

    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[1]?.query.get("offset")).toBe("1");
    expect(String(error)).toContain("2 documents");
  });

  it("stops on an empty page even when the total says otherwise", async () => {
    // A corpus that shrank between two pages must not loop forever.
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, { items: [], page: { total: 99, limit: 200, offset: 0 } });
    });
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "user" });

    const error: unknown = await runFolderDelete(harness.context).catch((cause: unknown) => cause);

    expect(stub.requests).toHaveLength(1);
    expect(String(error)).toContain("it holds no documents");
  });
});

describe("corpus folder delete --yes", () => {
  it("posts the delete and prints the ids it removed", async () => {
    const removed = { documents: [{ id: "doc_a1b2c3" }, { id: "doc_c3d4e5" }], warnings: [] };
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, removed);
    });
    const harness = stubContext(stub, {
      args: { path: "finance/2024" },
      flags: { yes: true },
      actor: "user",
    });

    await runFolderDelete(harness.context);

    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/folders/delete");
    expect(request?.headers["x-corpus-author"]).toBe("user");
    expect(JSON.parse(request?.body ?? "")).toEqual({ path: "finance/2024" });
    // No preview: `--yes` means the caller has decided, so nothing is listed
    // first and the delete is one request.
    expect(stub.requests).toHaveLength(1);
    expect(harness.stdout()).toBe("doc_a1b2c3\ndoc_c3d4e5\ndeleted finance/2024 — 2 documents\n");
  });

  it("emits the server's response unchanged under --json", async () => {
    const removed = { documents: [{ id: "doc_a1b2c3" }], warnings: [] };
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 200, removed);
    });
    const harness = stubContext(stub, {
      args: { path: "finance/2024" },
      flags: { yes: true },
      json: true,
      actor: "user",
    });

    await runFolderDelete(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(removed);
  });
});
