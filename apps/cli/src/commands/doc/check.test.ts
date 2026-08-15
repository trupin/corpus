import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_PAGE_LIMIT, type CheckFinding, type CheckReport } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { CheckFailedError, UsageError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
  type StubRequest,
} from "../../testing/stub-server.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import { checkCommand, runDocCheck } from "./check.js";
import { docTopic } from "./index.js";

/**
 * `corpus doc check` is what a pre-commit hook gates on, so the two things
 * tested hardest are the ones a hook depends on: **which** documents were sent,
 * and **what exit code** came back. Everything else is rendering.
 */

const ERROR_FINDING: CheckFinding = {
  code: "anchor-unused",
  severity: "error",
  docId: "doc_a1b2c3",
  path: "data/docs/notes/plan.md",
  detail: "anchor anc_1 belongs to no thread",
};

const WARNING_FINDING: CheckFinding = {
  code: "ref-unresolved",
  severity: "warning",
  docId: "doc_a1b2c3",
  path: "data/docs/notes/plan.md",
  detail: "[[doc_nope]] names no document",
};

const CLEAN: CheckReport = { ok: true, errors: [], warnings: [] };
const DRIFTED: CheckReport = { ok: false, errors: [ERROR_FINDING], warnings: [WARNING_FINDING] };
const WARNED: CheckReport = { ok: true, errors: [], warnings: [WARNING_FINDING] };

const parseBody = (request: StubRequest | undefined): unknown =>
  JSON.parse(request?.body ?? "null");

/** A `GET /api/docs` page, and the check report for whatever is posted. */
function docsAndCheck(ids: readonly string[], report: CheckReport = CLEAN) {
  return (request: StubRequest, response: ServerResponse): void => {
    if (request.path === "/api/docs") {
      const limit = Number(request.query.get("limit") ?? MAX_PAGE_LIMIT);
      const offset = Number(request.query.get("offset") ?? 0);
      sendJson(response, 200, {
        items: ids.slice(offset, offset + limit).map((id) => docRow(id)),
        page: { total: ids.length, limit, offset },
      });
      return;
    }
    sendJson(response, 200, report);
  };
}

function docRow(id: string): Record<string, unknown> {
  return {
    id,
    type: "note",
    title: id,
    path: `data/docs/inbox/${id}.md`,
    status: "open",
    created: null,
    updated: null,
    tags: [],
    pinned: false,
    order: null,
    due: null,
    reviewed: null,
    evergreen: false,
    origin: null,
    threadCount: 0,
    openThreadCount: 0,
    unreadCount: 0,
    stale: null,
    needs: [],
    snippets: [],
  };
}

const execFileAsync = promisify(execFile);
const STAGED_CONTENT = "---\nid: doc_a1b2c3\ntype: note\ntitle: Staged\n---\n\nin the index\n";

/** A real repository — `--staged` reads git's index, and only a real one has one. */
async function emptyRepo(): Promise<string> {
  const repo = makeTempDir("check");
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repo });
  return repo;
}

async function stagedRepo(): Promise<string> {
  const repo = await emptyRepo();
  mkdirSync(join(repo, "data/docs/inbox"), { recursive: true });
  writeFileSync(join(repo, "data/docs/inbox/staged.md"), STAGED_CONTENT, "utf8");
  // A non-document alongside it: it is staged, and it must not be submitted.
  writeFileSync(join(repo, "README.md"), "# not a corpus document\n", "utf8");
  await execFileAsync("git", ["add", "--all", "--", "."], { cwd: repo });
  return repo;
}

afterEach(closeStubServers);
afterEach(removeTempDirs);

describe("corpus doc check — the three input forms", () => {
  it("posts the named ids and passes when nothing failed", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));

    const harness = stubContext(stub, { args: { id: ["doc_a1b2c3", "doc_d4e5f6"] } });
    await runDocCheck(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/check");
    expect(parseBody(stub.requests[0])).toEqual({ ids: ["doc_a1b2c3", "doc_d4e5f6"] });
    expect(harness.stdout()).toBe("checked 2 documents — no findings.\n");
  });

  it("enumerates the whole workspace when no ids are given, archived included", async () => {
    const stub = await startStubServer(docsAndCheck(["doc_one", "doc_two"]));

    const harness = stubContext(stub);
    await runDocCheck(harness.context);

    const [enumeration] = stub.requestsTo("/api/docs");
    expect(enumeration?.query.get("includeArchived")).toBe("true");
    expect(enumeration?.query.get("limit")).toBe(String(MAX_PAGE_LIMIT));
    expect(enumeration?.query.get("offset")).toBe("0");
    expect(parseBody(stub.requestsTo("/api/check")[0])).toEqual({ ids: ["doc_one", "doc_two"] });
  });

  it("paginates the enumeration and still posts exactly one check request", async () => {
    const ids = Array.from({ length: MAX_PAGE_LIMIT + 3 }, (_, index) => `doc_${String(index)}`);
    const stub = await startStubServer(docsAndCheck(ids));

    const harness = stubContext(stub);
    await runDocCheck(harness.context);

    expect(stub.requestsTo("/api/docs")).toHaveLength(2);
    expect(stub.requestsTo("/api/docs")[1]?.query.get("offset")).toBe(String(MAX_PAGE_LIMIT));
    expect(stub.requestsTo("/api/check")).toHaveLength(1);
    expect(parseBody(stub.requestsTo("/api/check")[0])).toEqual({ ids });
    expect(harness.stdout()).toBe(`checked ${String(ids.length)} documents — no findings.\n`);
  });

  it("stops enumerating on a short page rather than trusting `total` alone", async () => {
    // A document deleted mid-walk leaves `total` unreachable; a loop that only
    // compared offsets against it would poll forever.
    const stub = await startStubServer((request, response) => {
      if (request.path === "/api/docs") {
        sendJson(response, 200, {
          items: [],
          page: { total: 500, limit: MAX_PAGE_LIMIT, offset: 0 },
        });
        return;
      }
      sendJson(response, 200, CLEAN);
    });

    const harness = stubContext(stub);
    await runDocCheck(harness.context);

    expect(stub.requestsTo("/api/docs")).toHaveLength(1);
    expect(parseBody(stub.requestsTo("/api/check")[0])).toEqual({ ids: [] });
  });

  it("posts staged (path, content) pairs from a real index, never ids", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));
    const repo = await stagedRepo();

    const harness = stubContext(stub, { flags: { staged: true } });
    await runDocCheck({ ...harness.context, workspace: { ...stub.workspace, root: repo } });

    expect(parseBody(stub.requests[0])).toEqual({
      documents: [{ path: "data/docs/inbox/staged.md", content: STAGED_CONTENT }],
    });
    expect(harness.stdout()).toBe("checked 1 document — no findings.\n");
  });

  it("prints nothing and sends an empty documents array when the index is clean", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));
    const repo = await emptyRepo();

    const harness = stubContext(stub, { flags: { staged: true } });
    await runDocCheck({ ...harness.context, workspace: { ...stub.workspace, root: repo } });

    // The server answers `200` for the empty set, so silence is a rendering
    // choice here rather than a client-side special case.
    expect(parseBody(stub.requests[0])).toEqual({ documents: [] });
    expect(harness.stdout()).toBe("");
  });

  it("refuses to combine --staged with ids rather than dropping one silently", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));

    const harness = stubContext(stub, { args: { id: ["doc_a1b2c3"] }, flags: { staged: true } });

    await expect(runDocCheck(harness.context)).rejects.toBeInstanceOf(UsageError);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("corpus doc check — the verdict", () => {
  it("exits 6 on errors, with every finding rendered", async () => {
    const stub = await startStubServer(jsonResponder(200, DRIFTED));

    const harness = stubContext(stub, { args: { id: ["doc_a1b2c3"] } });
    const failure = await runDocCheck(harness.context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CheckFailedError);
    expect((failure as CheckFailedError).exitCode).toBe(6);
    expect(harness.stdout()).toBe(
      [
        "error anchor-unused data/docs/notes/plan.md: anchor anc_1 belongs to no thread",
        "warning ref-unresolved data/docs/notes/plan.md: [[doc_nope]] names no document",
        "",
      ].join("\n"),
    );
    expect((failure as CheckFailedError).message).toBe("1 error in 1 document, plus 1 warning.");
  });

  it("exits 0 on warnings alone and still prints them", async () => {
    const stub = await startStubServer(jsonResponder(200, WARNED));

    const harness = stubContext(stub, { args: { id: ["doc_a1b2c3"] } });
    await runDocCheck(harness.context);

    expect(harness.stdout()).toBe(
      [
        "warning ref-unresolved data/docs/notes/plan.md: [[doc_nope]] names no document",
        "checked 1 document — 1 warning, no errors.",
        "",
      ].join("\n"),
    );
  });

  it("emits the server's report unchanged under --json, and still fails on errors", async () => {
    const stub = await startStubServer(jsonResponder(200, DRIFTED));

    const harness = stubContext(stub, { args: { id: ["doc_a1b2c3"] }, json: true });
    await expect(runDocCheck(harness.context)).rejects.toBeInstanceOf(CheckFailedError);

    expect(harness.stdout()).toBe(`${JSON.stringify(DRIFTED)}\n`);
    expect(JSON.parse(harness.stdout())).toEqual(DRIFTED);
  });

  it("says nothing at all when there was nothing to check", async () => {
    const stub = await startStubServer(docsAndCheck([]));

    const harness = stubContext(stub);
    await runDocCheck(harness.context);

    expect(harness.stdout()).toBe("");
  });

  it("still emits one JSON value when nothing was checked", async () => {
    const stub = await startStubServer(docsAndCheck([]));

    const harness = stubContext(stub, { json: true });
    await runDocCheck(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(CLEAN)}\n`);
  });
});

describe("the doc check command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [docTopic] })).toEqual(
      [],
    );
  });

  it("declares one optional variadic id and only --staged", () => {
    expect(checkCommand.args).toEqual([
      {
        name: "id",
        required: false,
        variadic: true,
        description: "Documents to check. Omit them to check the whole workspace.",
      },
    ]);
    expect(checkCommand.flags.map((flag) => flag.name)).toEqual(["staged"]);
    expect(checkCommand.requiresWorkspace).not.toBe(false);
  });

  it("documents the exit-6 verdict, the --staged form and the duplicate-id gap", () => {
    expect(checkCommand.description).toContain("**6**");
    expect(checkCommand.description).toContain("index");
    expect(checkCommand.description).toContain("duplicate-id");
    expect(checkCommand.description).toContain("corpus db doctor");
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = checkCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('{"ok":false');
    expect(machine?.description).toContain('"warnings"');
  });

  it("is reachable as `corpus doc check`", () => {
    expect(docTopic.commands.map((command) => command.name)).toContain("check");
  });
});
